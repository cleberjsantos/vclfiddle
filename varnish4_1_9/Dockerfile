FROM ubuntu:16.04
LABEL maintainer "vclfiddle.net <support@vclfiddle.net>"

RUN apt-get update && \
  apt-get install --assume-yes --no-install-recommends \
    automake \
    apt-transport-https \
    apt-utils \
    build-essential \
    ca-certificates \
    curl \
    gcc \
    libc6-dev \
    libc-dev \
    linux-libc-dev \
    libedit-dev \
    libjemalloc-dev \
    libncurses-dev \
    libpcre3-dev \
    libtool \
    netcat \
    pkg-config \
    python-docutils \
    wget

# Install Varnish from source, so that Varnish modules can be compiled and installed.
ENV VARNISH_VERSION=4.1.9 \
    VARNISH_SHA256SUM=22d884aad87e585ce5f3b4a6d33442e3a855162f27e48358c7c93af1b5f2fc87

RUN apt-get update && \
  mkdir -p /usr/local/src && \
  cd /usr/local/src && \
  curl -sfLO http://varnish-cache.org/_downloads/varnish-$VARNISH_VERSION.tgz && \
  echo "${VARNISH_SHA256SUM} varnish-$VARNISH_VERSION.tgz" | sha256sum -c - && \
  tar -xzf varnish-$VARNISH_VERSION.tgz && \
  cd varnish-$VARNISH_VERSION && \
  ./autogen.sh && \
  ./configure && \
  make install && \
  ldconfig && \
  rm ../varnish-$VARNISH_VERSION.tgz && \
  mkdir /etc/varnish && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* \
     /usr/share/man/* \
     /usr/local/src/varnish-$VARNISH_VERSION

ADD ./secret /etc/varnish/secret

RUN chmod 600 /etc/varnish/secret

VOLUME ["/fiddle"]
CMD ["/bin/bash", "/run.sh"]
ADD run.sh /run.sh
ADD vtctrans.py /vtctrans.py
