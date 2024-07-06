# SFU Implementation

***Table of contents***

- [SFU Implementation](#sfu-implementation)
  - [Client setup](#client-setup)
  - [Server setup](#server-setup)
  - [Get Media streams](#get-media-streams)
  - [Get RTP capabilities](#get-rtp-capabilities)
  - [Create Device](#create-device)
  - [Create send transport.(Client)](#create-send-transportclient)
  - [Create transport.(Server)](#create-transportserver)
  - [Connect send transport](#connect-send-transport)
  - [Connect producer transport](#connect-producer-transport)
  - [Start produce](#start-produce)

## Client setup

```js
import { Device } from "mediasoup-client";
import io from "socket.io-client";

const socket = io("https://192.168.220.186:3300");
const device = new Device();

// producer parameter
let params = {
  // track will be added once media stream get done.
  // track: MediaStream

  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
  encodings: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

```

## Server setup

```js
import express from "express";
import { Server } from "socket.io";
import mediasoup from "mediasoup";

import https from "https";
import cors from "cors";
import fs from "fs";

const app = express();

const option = {
  key: fs.readFileSync("server.key"),
  cert: fs.readFileSync("ssl.cert"),
};
const server = https.createServer(option, app);

const allowedHeaders = [
  "https://localhost:3000",
  "https://192.168.220.186:3000",
  "https://192.168.220.186:3300",
];

// socket
const io = new Server(server, {
  cors: {
    origin: allowedHeaders,
  },
});

app.use(
  cors({
    origin: function (origin, callback) {
      if (allowedHeaders.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by cors."));
      }
    },
  })
);

app.get("/", (req, res) => {
  res.send("SFU Architecture.");
});

server.listen(3300, "192.168.220.186", () => {
  console.log("Server running on port 3300");
});

// mediasoup variables
let worker;
let router;
let producerTransport;
let producer;
let consumerTransport;
let consumer;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });

  console.log("worker pid", worker.pid);

  worker.on("died", () => {
    console.log("worker died.");
    setTimeout(() => process.exit(1), 2000);
  });
};

// create worker
createWorker();

// media codes
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];
```

## Get Media streams

1. get media streams
2. get track for producer transport to stream

client

```js
  const getUserMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({video: true });
      videoClientRef.current.srcObject = stream;
      params = {
        track: stream.getTracks()[0],
        ...params,
      };
    } catch (error) {
      console.log("Error/get media streams:", error);
    }
  };
```

## Get RTP capabilities

An Object with the RTP capabilities of the router. These capabilities are typically needed by mediasoup clients to compute their sending RTP parameters.

1. get RTP capabilities from server
2. create device with RTP capabilities

client

```js
  socket.emit("GET_RTP_CAPABILITIES", (params) => {
    rtpCapabilities = params.rtpCapabilities;
    createDevice();
  });
```

server

```js
  socket.on("GET_RTP_CAPABILITIES", async (callback) => {
    if (!router) {
      router = await worker.createRouter({ mediaCodecs });
    }
    callback({ rtpCapabilities: router.rtpCapabilities });
  });
```

## Create Device

Loads the device with the RTP capabilities of the mediasoup router. This is how the device knows about the allowed media codecs and other settings.

1. load the device

client

```js
  const createDevice = async () => {
    try {
      await device.load({ routerRtpCapabilities: rtpCapabilities });
    } catch (error) {
      console.log("Error/create device:", error);
    }
  };
```

## Create send transport.(Client)

1. emit an event to server for create webRtc producer transport.
2. get required parameters to create send transport.
3. create producer transport
4. start produce streams to the server

***To create send transport***

- transport id
- iceCandidates
- iceParameters
- iceParameters

client

```js
  const createSendTransport = async () => {
    // get transport parameters from server
    socket.emit("CREATE_WEBRTC_TRANSPORT", { sender: true }, async (params) => {
      if (params.error) {
        console.log("Error/create send transport:", params.error);
        return;
      }

      producerTransport = device.createSendTransport(params);

      // connect send transport
      connectSendTransport();
    });
  };
```

## Create transport.(Server)

Creates a new WebRTC transport.

server

1. create webrtc transport with router and return to the client transport parameters.

```js
  // create webtrc transport
  const createWebRtcTransport = async (callback) => {
    const webRtc__options = {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: "192.168.220.186",
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    };

    try {
      const transport = await router.createWebRtcTransport(webRtc__options);

      transport.on("dtlsstatechange", (dtlsstatechange) => {
        if (dtlsstatechange === "closed") {
          transport.close();
        }
      });

      transport.on("close", (dtlsstatechange) => {
        console.log("transport closed.");
      });

      callback({
        id: transport.id,
        iceCandidates: transport.iceCandidates,
        iceParameters: transport.iceParameters,
        dtlsParameters: transport.dtlsParameters,
      });

      return transport;

    } catch (error) {
      callback({ error: error });
    }
  };


  // create webrtc transport
  socket.on("CREATE_WEBRTC_TRANSPORT", async ({ sender }, callback) => {
    if (sender) {
      producerTransport = await createWebRtcTransport(callback);
    } else {
      consumerTransport = await createWebRtcTransport(callback);
    }
  });
```

## Connect send transport

client

```js
  const connectSendTransport = async () => {
    producer = await producerTransport.produce(params);

    producerTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        try {
          // connect send transport on server
          await socket.emit("TRANSPORT_CONNECT", dtlsParameters);

          // must be invoked to tell server dtls parameter transferred
          callback();
        } catch (error) {
          console.log("Error/producer transport on connect:", error);
          errback(error);
        }
      }
    );

    producerTransport.on("produce", async (params, callback, errback) => {
      try {
        const { kind, rtpParameters } = params;
        await socket.emit("TRANSPORT_PRODUCE", { kind, rtpParameters }, (id) => {
          callback({ id });
        });
      } catch (error) {
        console.log("Error/producer transport on produce:", error);
        errback(error);
      }
    });

    producer.on("trackended", () => {
      console.log("video ended.");
    });

    producer.on("transportclose", () => {
      console.log("transport closed.");
    });
  };

```

## Connect producer transport

1. `producerTransport.connect` provides webrtc transport secure connection. Once connected transport then next invoke `callback` or `errback` from the client to inform server from "connect" event.
2. once webrtc transport ready then from the client can start produce streams.

server

```js
  // transport connect - produce
  socket.on("TRANSPORT_CONNECT", async (dtlsParameters) => {
    try {
      await producerTransport.connect({ dtlsParameters });
    } catch (error) {
      console.log("Error/TRANSPORT_CONNECT", error);
    }
  });
```

## Start produce

client

1. get `kind, rtpParameters` from "produce" event and emit this event "TRANSPORT_PRODUCE"  to server.
2. once server returned "producer" - `id` . Then invoke `callback` or `errback` of "produce" event.
3. finally done, now client start producing streams to server.

```js
  producerTransport.on("produce", async (params, callback, errback) => {

    try {
      const { kind, rtpParameters } = params;
      await socket.emit("TRANSPORT_PRODUCE", { kind, rtpParameters }, (id) => {
        callback({ id });
      });
    } catch (error) {
      console.log("Error/producer transport on produce:", error);
      errback(error);
    }
  });
```

server

1. `producerTransport.produce` Instructs the router to receive audio or video RTP (or SRTP depending on the transport class). This is the way to inject media into mediasoup.
2. return producer id

```js
  // transport produce
  socket.on("TRANSPORT_PRODUCE", async ({ kind, rtpParameters }, callback) => {
    try {
      producer = await producerTransport.produce({ kind, rtpParameters });
      callback(producer.id);
    } catch (error) {
      console.log("Error/TRANSPORT_PRODUCE", error);
    }
  });
```
