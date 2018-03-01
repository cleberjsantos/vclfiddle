#!/bin/bash

function debuglog {
  echo "$(date '+%Y-%m-%d %T.%3N') $@" >>/fiddle/debug.log
}

function varnishcommand {
  debuglog "Executing Varnish command: $@"
  /usr/local/bin/varnishadm -T 127.0.0.1:6082 -S /etc/varnish/secret $@ >/tmp/varnishcommand.log 2>>/fiddle/run.log ||
    { EXITCODE=$?; cat /tmp/varnishcommand.log >>/fiddle/run.log; exit $EXITCODE; }
  debuglog "Executed Varnish command: $@"
}

function executerequest {
  REQUEST_FILE=$1
  debuglog "Executing request $REQUEST_FILE"
  RESPONSE_FILE=$(basename $REQUEST_FILE)
  RESPONSE_FILE=$(dirname $REQUEST_FILE)/response_${RESPONSE_FILE#request_}
  cat $REQUEST_FILE  | nc 127.0.0.1 80 | sed -e '/^\s*$/,$d' >$RESPONSE_FILE
}

function run {
  debuglog "Starting varnishd"
  /usr/local/sbin/varnishd -a 127.0.0.1:80 -b 127.0.0.1:8080 -T 127.0.0.1:6082 -S /etc/varnish/secret -P /run/varnishd.pid -p vcl_trace=on 2>&1 >>/fiddle/run.log || exit $?
  debuglog "Started varnishd"

  varnishcommand vcl.load fiddle /fiddle/default.vcl
  varnishcommand vcl.use fiddle

  debuglog "Starting varnishlog"
  varnishlog -D -w /tmp/rawvarnishlog -P /run/varnishlog.pid 2>&1 >>/fiddle/run.log || exit $?
  debuglog "Started varnishlog"

  debuglog "Starting varnishncsa"
  NCSA_FORMAT='%{X-Varnish}o\t%T\t%O\t%{Varnish:time_firstbyte}x\t%{Varnish:hitmiss}x\t%{Varnish:handling}x'
  varnishncsa -D -w /fiddle/varnishncsa -P /run/varnishncsa.pid -F "$NCSA_FORMAT" 2>&1 >>/fiddle/run.log || exit $?
  debuglog "Started varnishncsa"

  debuglog "Executing requests"
  for ITEM in /fiddle/request_*; do
    executerequest $ITEM
  done
  debuglog "Executed requests"

  debuglog "Flushing varnishlog"
  kill -s SIGUSR1 $(cat /run/varnishlog.pid)

  debuglog "Flushing varnishncsa"
  kill -s SIGUSR1 $(cat /run/varnishncsa.pid)

  debuglog "Done"
}

function vtest {
  VTC_FILE=$1
  VCL_FILE=$2

  debuglog "Starting varnishtest"
  if [ ! -e $VTC_FILE ]; then
    debuglog "VCT File: $VTC_FILE not found"
    exit 1
  fi

  debuglog "Testing $VTC_FILE with $VCL_FILE"
  COMBINED_FILE=/fiddle/$RANDOM$(basename $VTC_FILE)
  sed -e '/# VCL_PLACEHOLDER/ r '${VCL_FILE} -e 's/# VCL_PLACEHOLDER//' ${VTC_FILE} > ${COMBINED_FILE}
  varnishtest -v ${COMBINED_FILE} 2>&1 >>/fiddle/run.log || exit $?

  debuglog "running ${COMBINED_FILE}"
  debuglog "Started varnishtest"
  debuglog "Done"
}

function vtctrans {
  VTC_FILE=$1
  VCL_FILE=$2

  debuglog "Starting varnishtest"
  if [ ! -e $VTC_FILE ]; then
    debuglog "VCT File: $VTC_FILE not found"
    exit 1
  fi

  debuglog "Testing $VTC_FILE using vtctrans in $VCL_FILE"
  COMBINED_FILE=/fiddle/$RANDOM$(basename $VTC_FILE)
  sed -e '/# VCL_PLACEHOLDER/ r '${VCL_FILE} -e 's/# VCL_PLACEHOLDER//' ${VTC_FILE} > ${COMBINED_FILE}
  python /vtctrans.py -s ${COMBINED_FILE} 2>&1 >>/fiddle/run.log || exit $?

  debuglog "running ${COMBINED_FILE}"
  debuglog "Started varnishtest"
  debuglog "Done"
}

if [ "$1" == "test" ]; then
   vtest $2 $3
elif [ "$1" == "vtctrans" ]; then
   vtctrans $2 $3
else
   run
fi

