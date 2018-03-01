#!/bin/bash

SCRIPTROOT=/vagrant

echo "ubuntu:ubuntu" | sudo chpasswd
sudo adduser --disabled-password --gecos "" vagrant
sudo adduser vagrant adm

# install docker
if ! command -v docker >/dev/null; then
  curl -sSL https://get.docker.com/ | sudo sh
fi

# install g++ via build-essential
if ! command -v g++ >/dev/null; then
  sudo apt-get install --assume-yes build-essential
fi

# install nodejs
if ! command -v npm >/dev/null; then
  curl -sL https://deb.nodesource.com/setup_4.x | sudo bash -
  sudo apt-get install --assume-yes nodejs
fi

if ! command -v node-gyp >/dev/null; then
    sudo apt-get install --assume-yes node-gyp
fi

# install sails.js
if ! command -v sails >/dev/null; then
  sudo npm install --global sails@0.10.5
fi

# install the web app
sudo rsync -av $SCRIPTROOT/web/ /var/web/
pushd /var/web && sudo npm install && popd
sudo mkdir -p /var/web/.tmp && sudo chown -R 1001 /var/web/.tmp

# build the Varnish docker image
$SCRIPTROOT/varnish5_2_1/build.sh
$SCRIPTROOT/varnish5_1_3/build.sh
$SCRIPTROOT/varnish5_0_0/build.sh
$SCRIPTROOT/varnish4_1_9/build.sh
$SCRIPTROOT/varnish4_0_5/build.sh
$SCRIPTROOT/varnish3_0_7/build.sh
$SCRIPTROOT/varnish2_1_5/build.sh
$SCRIPTROOT/varnish2_0_6/build.sh

# Remove unused images
# More details here: https://docs.docker.com/engine/reference/commandline/image_prune/
sudo docker image prune -f

# install the setuid run-varnish-container script
sudo apt-get install --assume-yes gcc
sudo mkdir --parents /opt/vclfiddle/
sudo gcc $SCRIPTROOT/run-varnish-container.c -o /opt/vclfiddle/run-varnish-container
sudo cp $SCRIPTROOT/run-varnish-container.py /opt/vclfiddle/run-varnish-container.py
sudo cp $SCRIPTROOT/vtctrans.py /opt/vclfiddle/vtctrans.py
sudo chown root:root /opt/vclfiddle/run-varnish-container*
sudo chown root:root /opt/vclfiddle/vtctrans.py
sudo chmod 04755 /opt/vclfiddle/run-varnish-container
sudo chmod 755 /opt/vclfiddle/run-varnish-container.py
sudo chmod 755 /opt/vclfiddle/vtctrans.py

# TODO install nginx on port 80 to proxy to sails 1337

# test the app
sudo npm install --global mocha

sudo mkdir --parents /var/lib/vclfiddle/
sudo chown vagrant:adm /var/lib/vclfiddle/
sudo chmod 0775 /var/lib/vclfiddle/

sudo rsync -av /vagrant/web/ /var/web/ && cd /var/web && sudo npm install && npm test
sudo rsync -av /vagrant/web/ /var/web/ && cd /var/web && node app.js
