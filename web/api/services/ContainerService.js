var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var Q = require('q');

function countdownCallback(count, onZeroCallback) {
  return function () {
    count--;
    if (count == 0) onZeroCallback();
  };
}

function writeInputFiles (dirPath, requests, vclText, callback) {

  if (!(requests instanceof Array) || requests.length == 0) {
    return callback(new Error('At least one request is required'));
  }

  fs.writeFile(path.join(dirPath, 'default.vcl'), vclText, function (err) {
    if (err) return callback(err);

    var success = countdownCallback(requests.length, callback);
    requests.forEach(function (r, index) {

      var filename = 'request_' + ('000' + index).slice(-3);
      fs.writeFile(path.join(dirPath, filename), r.payload, function (err) {
        if (err) return callback(err);
        success();
      });

    });

  });

}

function writeTestFiles (dirPath, vtctrans, vclText, vtcText, callback) {

  fs.writeFile(path.join(dirPath, 'default.vcl'), vclText, function (err) {
    if (err) return callback(err);

    var vtcTitle = vtcText.split(/\r?\n/)[0].split(/^\s*varnishtest\s+/)[1].replace(/\"/g,'');
    var vtcId    = Math.floor(Math.random() * 0x10000).toString(10);

    var filename = 'test_' + ('000' + vtcId + '.vtc');

    fs.writeFile(path.join(dirPath, filename), vtcText, function (err) {
      if (err) return callback(err);
      //return callback('success:' + filename);
      var req_status = {'status':'success',
                        'vtc': filename,
                        'use_trans': vtctrans}
      return callback(req_status);
    });


  });

}

function runContainer (dirPath, dockerImageName, callback) {

  var dockerTimeoutMillseconds = 30 * 1000;
  child_process.execFile('/opt/vclfiddle/run-varnish-container', [dockerImageName, dirPath], {timeout: dockerTimeoutMillseconds}, function(err, stdout, stderr) {
    if (err) return callback(err);

    sails.log.debug('Docker stdout: ' + stdout);
    sails.log.error('Docker stderr: ' + stderr);

    callback(null);
  });

}

function runVarnishtestContainer (dirPath, vtctrans, dockerImageName, vtc, vcl, callback) {

  var dockerTimeoutMillseconds = 30 * 1000;
  var dockerOpt = vtctrans === 'on' ? '--vtctrans' : '--test';

  child_process.execFile('/opt/vclfiddle/run-varnish-container', [dockerImageName, dirPath, dockerOpt, '--vtc=' + vtc, '--vcl=' + vcl], {timeout: dockerTimeoutMillseconds}, function(err, stdout, stderr) {
    if (err) return callback(err);

    sails.log.debug('Docker stdout: ' + stdout);
    sails.log.error('Docker stderr: ' + stderr);

    callback(null);
  });

}

function readOutputFiles(dirPath, callback) {

  var readdir = Q.denodeify(fs.readdir);
  var readFile = Q.denodeify(fs.readFile);

  const responseFilePrefix = 'response_';

  var result = {
    runlog: null,
    varnishlog: null,
    varnishncsa: null,
    responses: []
  };

  var runlogPromise = readFile(path.join(dirPath, 'run.log'), { encoding: "utf8" })
    .then(function (data) {
      result.runlog = data;
    });

  var varnishlogPromise = readFile(path.join(dirPath, 'varnishlog'), { encoding: "utf8" })
    .then(function (data) {
      result.varnishlog = data;
    })
    .catch(function (error) { /* swallow */ });

  var varnishncsaPromise = readFile(path.join(dirPath, 'varnishncsa'), { encoding: "utf8" })
    .then(function (data) {
      result.varnishncsa = data;
    })
    .catch(function (error) { /* swallow */ });

  var responsesPromise = readdir(dirPath)
    .then(function (files) {
        return files.filter(function (f) {
          return f.slice(0, responseFilePrefix.length) == responseFilePrefix;
        });
    })
    .then(function (files) {
      return Q.all(
        files.map(function (f) {
          var index = parseInt(f.slice(responseFilePrefix.length), 10);
          return readFile(path.join(dirPath, f), { encoding: "utf8" })
            .then(function (data) {
              result.responses[index] = data;
            });
        })
      );
    });

  return Q.all([runlogPromise, varnishlogPromise, varnishncsaPromise, responsesPromise])
    .then(function () {
      return callback(null, result);
    })
    .catch(callback)
    .done();

}

module.exports = {
  beginVtc: function (dirPath, vtctrans, vclText, vtcText, dockerImageName, hasStartedCallback, hasCompletedCallback) {
    if (typeof hasCompletedCallback !== 'function') {
      throw new TypeError('Fifth argument "hasCompletedCallback" must be a function.');
    }

    sails.log.debug('Begin tests with vcl in: ' + dirPath);

    writeTestFiles(dirPath, vtctrans, vclText, vtcText, function (err) {

      if (err) {

        var wstatus = err['status'];
        var vtctrans = err['use_trans'];

        if (typeof(wstatus) === 'string' && wstatus === 'success'){
          var vtc_file = err['vtc'];
          var vcl_file = 'default.vcl';

          runVarnishtestContainer(dirPath, vtctrans, dockerImageName, vtc_file, vcl_file, function (err) {
            sails.log.debug('Run container completed for: ' + dirPath);
            hasCompletedCallback(err, dirPath);
          });
        } else { return hasStartedCallback(err);}
      }

      hasStartedCallback();

    })
  },

  beginReplay: function (dirPath, includedRequests, vclText, dockerImageName, hasStartedCallback, hasCompletedCallback) {

    if (typeof hasCompletedCallback !== 'function') {
      throw new TypeError('Fifth argument "hasCompletedCallback" must be a function.');
    }

    sails.log.debug('Begin replaying requests with vcl in: ' + dirPath);

    writeInputFiles(dirPath, includedRequests, vclText, function (err) {

      if (err) return hasStartedCallback(err);

      runContainer(dirPath, dockerImageName, function (err) {
        sails.log.debug('Run container completed for: ' + dirPath);
        hasCompletedCallback(err, dirPath);
      });

      hasStartedCallback();

    });

  },

  getReplayResult: function (dirPath, callback) {
    fs.readFile(path.join(dirPath, 'completed'), { encoding: "utf8" }, function (err, data) {
      if (err) {
        if (err instanceof Error && err.code === 'ENOENT') {
          // not completed yet
          return callback(null, {});
        }
        sails.log.error(err);
        return callback(new Error('Could not read completion information.'));
      }

      try {
        var completedData = JSON.parse(data);
      } catch (err) {
        sails.log.error(err);
        return callback(new Error('Could not parse completion information.'));
      }

      return callback(null, completedData);

    });
  },

  readOutputFiles: readOutputFiles

};
