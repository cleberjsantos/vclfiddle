#!/usr/bin/env python
# -*- coding: utf-8 -*-
import os
import sys
import re
from subprocess import Popen, PIPE
import argparse
import logging

from logging.handlers import RotatingFileHandler

parser = argparse.ArgumentParser()
parser.add_argument('--test', action='store_true', default=False,
                    help='Run with varnishtest')

parser.add_argument('--vtc', action='store', default=False,
                    dest='vtc',
                    help='Set a VCT File Path')

parser.add_argument('--vcl', action='store', default=False,
                    dest='vcl',
                    help='Set a VCL File Path')

progname = parser.prog
opts_known = parser.parse_known_args()
logfile = '/var/log/run-varnish.log'
stderr = sys.stderr
stdout = sys.stdout
exit = sys.exit
__base = os.getcwd()

specialMatch = re.compile(r'^(\w+)$').search
dirSearch = re.compile(r'^(\/var\/lib\/vclfiddle\/vclfiddle\-[\w\/\-]+)$').search


def msgWarn(msg=''):
    if msg:
        stderr.write(msg + '\n')
    else:
        stderr.write("Usage: %s IMAGENAME DIRPATH\n" % (__base + progname))
    exit(2)


def create_rotating_log(msg, level=''):
    """ Creates a rotating log """
    level = level or 'info'
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - [%(levelname)s] - %(message)s')

    logger = logging.getLogger("VCLFiddle")
    logger.setLevel(logging.DEBUG)

    # add a rotating handler
    handler = RotatingFileHandler(logfile,
                                  maxBytes=10000000,
                                  backupCount=3)
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    if level == 'error':
        logger.error(msg)
    elif level == 'debug':
        logger.debug(msg)
        logger.info(msg)
    else:
        logger.info(msg)


def main():
    imageName, dirPath = opts_known[1][:2]
    opt_dict = opts_known[0].__dict__
    run_test = opt_dict.get('test', 'False')
    vtc = opt_dict.get('vtc', '')
    vcl = opt_dict.get('vcl', '')

    if not bool(specialMatch(imageName)):
        msgErr = 'Invalid characters in Image {}'.format(imageName)
        create_rotating_log(msgErr, 'error')
        msgWarn(msgErr)

    if not bool(dirSearch(dirPath)):
        msgErr = 'Invalid characters in Path {}'.format(dirPath)
        create_rotating_log(msgErr, 'error')
        msgWarn(msgErr)

    os.environ['PATH'] = "/bin:/usr/bin"
    if not run_test:
        cm = Popen(['/usr/bin/docker',
                    'run', '--rm', '-v', '{}:/fiddle'.format(dirPath),
                    '{}'.format(imageName)],
                   stdin=PIPE, stdout=PIPE, stderr=PIPE)
    else:
        cm = Popen(['/usr/bin/docker',
                    'run', '--rm', '-v', '{}:/fiddle'.format(dirPath),
                    '{}'.format(imageName),
                    '/run.sh', 'test', 'fiddle/{}'.format(vtc),
                    'fiddle/{}'.format(vcl)],
                   stdin=PIPE, stdout=PIPE, stderr=PIPE)
    stdout, stderr = cm.communicate()
    create_rotating_log('imageName: {}, dirPath: {}'.format(imageName,
                                                            dirPath), 'info')
    #print stderr
    #print stdout
    exit(0)

if len(sys.argv) < 3:
    msgWarn()

if __name__ == "__main__":
    main()
