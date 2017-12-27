/**
 * VclController
 *
 * @description :: Server-side logic for managing vcls
 * @help        :: See http://links.sailsjs.org/docs/controllers
 */
var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var temp = require('temp');
var url = require('url');

const defaultVcl = 'vcl 4.0;\n\nbackend default {\n .host = "www.vclfiddle.net";\n .port = "80";\n}';
const defaultHar = "curl http://www.vclfiddle.net --header 'User-Agent: vclFiddle'";
const defaultImage = 'varnish5_2_1';


const defaultVtc = 'varnishtest "Test external VCL"\n\n' +

'varnish v1 -vcl {\n' +
'   # VCL Here\n' +
'   vcl 4.0;\n\n' +

'   backend default {\n' +
'           .host = "www.vclfiddle.net";\n' +
'           .port = "80";\n' +
'   }\n\n' +

'   sub vcl_recv {\n' +
'           if (req.url ~ "/admin") {\n' +
'                   return(pass);\n' +
'           }\n' +
'   }\n' +

'} -start\n\n' +

'client c1 {\n' +
'  # First client request with VXID=1001\n' +
'  # Request misses.  Varnish creates backend request with VXID=1002.\n' +
'  # /index.html is cached from transaction VXID=1002\n' +
'  txreq -url "/index.html"\n' +
'  rxresp\n' +
'  expect resp.http.X-Varnish == "1001"\n\n' +

'  # Second client request with VXID=1003.\n' +
'  # Request misses.  Varnish creates backend request with VXID=1004.\n' +
'  # /admin is passed\n' +
'  txreq -url "/admin"\n' +
'  rxresp\n' +
'  expect resp.http.X-Varnish == "1003"\n\n' +

'  # Third client request with VXID=1005\n' +
'  # Request hit.  Varnish builds response from resource cached in transaction\n' +
'  # VXID=1002\n' +
'  txreq -url "/index.html"\n' +
'  rxresp\n' +
'  expect resp.http.X-Varnish == "1005 1002"\n\n' +

'  # Fourth client request with VXID=1006.\n' +
'  # Request misses.  (Varnish creates backend request with VXID=1007.)\n' +
'  # /admin is passed\n' +
'  txreq -url "/admin"\n' +
'  rxresp\n' +
'  expect resp.http.X-Varnish == "1006"\n' +
'} -run';



const supportedImages = {
  'varnish5_2_1': 'Varnish 5.2.1',
  'varnish5_1_3': 'Varnish 5.1.3',
  'varnish5_0_0': 'Varnish 5.0.0',
  'varnish4_1_9': 'Varnish 4.1.9',
  'varnish4_0_5': 'Varnish 4.0.5',
  'varnish3_0_7': 'Varnish 3.0.7',
  'varnish2_1_5': 'Varnish 2.1.5',
  'varnish2_0_6': 'Varnish 2.0.6',
};

function completeRun(err, fiddle, allRequests) {

  var completedData = { completedAt: new Date() };

  function writeCompletedData(err) {
    if (err instanceof Error) {
      completedData.error = err.message;
    } else if (err) {
      completedData.error = err.toString();
    }
    fs.writeFile(path.join(fiddle.path, 'completed'), JSON.stringify(completedData), { encoding: 'utf8' }, function (err) {
      if (err) sails.log.error(err);
    });
  }

  if (err) {
    sails.log.error('Run container error: ' + err);
    return writeCompletedData(err);
  }

  ContainerService.readOutputFiles(fiddle.path, function (err, output) {
    if (err) return writeCompletedData(err);
    if (output.runlog.length > 0) return writeCompletedData('Error: ' + output.runlog);

    var parsedNcsa = RequestMetadataService.parseVarnish4NCSA(output.varnishncsa);

    var results = RequestMetadataService.correlateResults(allRequests.includedRequests, output.responses, parsedNcsa, null);
    results = results.concat(allRequests.excludedRequests.map(function (r) { return { request: r }; }));

    completedData.log = output.varnishlog;
    completedData.results = results;
    writeCompletedData();
  });

}

module.exports = {
	index: function (req, res) {

      var fiddleid = req.params.fiddleid || '';
      var runindex = req.params.runindex || '0';

      if (!fiddleid) {
        return res.view({
          fiddleid: '',
          vcl: defaultVcl,
          har: defaultHar,
          log: '',
          image: defaultImage,
          supportedImages: supportedImages
        });
      }

      FiddlePersistenceService.getFiddleRun(fiddleid, runindex, function (err, fiddle) {

        if (err) return res.serverError(err);

        if (fiddle === null) return res.notFound();

        FiddlePersistenceService.loadViewState(fiddle, function (err, viewState) {
          if (err) return res.serverError(err);

          return res.view({
            fiddleid: fiddle.id,
            vcl: viewState.vcl,
            har: viewState.har,
            log: viewState.log,
            results: viewState.results,
            image: viewState.image,
            supportedImages: supportedImages
          })

        });

      });

    },

    test: function(req, res) {
      var fiddleid = req.params.fiddleid || '';
      var runindex = req.params.runindex || '0';
      if (!fiddleid) {
        return res.view({
          fiddleid: '',
          vtc: defaultVtc,
          log: '',
          image: defaultImage,
          supportedImages: supportedImages
        });
      }


    },

    result: function (req, res) {
      var fiddleid = req.query.fiddleid || '';
      var runindex = req.query.runindex || '0';
      if (!fiddleid) return res.badRequest();

      FiddlePersistenceService.getFiddleRun(fiddleid, runindex, function (err, fiddle) {

        if (err) return res.serverError(err);

        if (fiddle === null) return res.notFound();

        ContainerService.getReplayResult(fiddle.path, function (err, completedData) {
          if (err) return res.serverError(err);

          if (!completedData.completedAt) {
            // not complete yet
            // TODO timeout if too long to complete
            // TODO instruct client to cache only briefly if at all
            return res.ok({});
          }

          FiddlePersistenceService.loadViewState(fiddle, function (err, viewState) {
            if (err) return res.serverError(err);

            viewState.log = completedData.error || completedData.log,
            viewState.results = completedData.results

            FiddlePersistenceService.saveViewState(fiddle, viewState, function (err) {
              if (err) return res.serverError(err);

              return res.ok({
                log: viewState.log,
                results: viewState.results
              });

            });
          });
        });

      });
    },

    run: function (req, res) {
      var fiddleid = req.body.fiddleid || '';
      var vcl = req.body.vcl;
      var rawRequests = req.body.har;
      var dockerImage = req.body.image || defaultImage;


      if (Object.keys(supportedImages).indexOf(dockerImage) < 0) {
        sails.log.warn('Invalid image parameter:' + dockerImage);
        return res.badRequest();
      }

      if (typeof vcl !== 'string' || typeof rawRequests !== 'string') return res.badRequest();

      RequestMetadataService.parseInputRequests(rawRequests, function (err, _ignored, allRequests) {

        if (err) {
          return res.ok({
            fiddleid: fiddleid,
            vcl: vcl,
            har: rawRequests,
            log: err.toString()
          }, 'vcl/index');
        }

        if (allRequests.includedRequests.length == 0) {
          return res.ok({
            fiddleid: fiddleid,
            vcl: vcl,
            har: rawRequests,
            log: 'HAR does not contain any supported requests.'
          }, 'vcl/index');
        }

        if (!!req.body.dbl) {
          allRequests.includedRequests = allRequests.includedRequests.concat(allRequests.includedRequests);
        }

        FiddlePersistenceService.prepareFiddle(fiddleid, function (err, fiddle) {
          if (err) return res.serverError(err);

          // TODO persist state of 'replay requests twice' option

          ContainerService.beginReplay(fiddle.path, allRequests.includedRequests, vcl, dockerImage, function (err) {
            // started

            var viewState = {
              image: dockerImage,
              vcl: vcl,
              har: rawRequests
            };
            if (err) {
              viewState.log = 'Error: ' + err;
            }

            FiddlePersistenceService.saveViewState(fiddle, viewState, function (err) {
              if (err) return res.serverError(err);

              return res.ok({
                fiddleid: fiddle.id,
                runindex: fiddle.runIndex,
                vcl: viewState.vcl,
                har: viewState.har,
                log: viewState.log
              });

            });

          }, function (err) {
            // completed
            return completeRun(err, fiddle, allRequests);
          });

        });

      });

    }

};

