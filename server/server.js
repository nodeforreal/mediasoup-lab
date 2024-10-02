const express = require("express");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const https = require("http");
const cors = require("cors");
const fs = require("fs");
const os = require("os")
const path = require("path");
const child_process = require("child_process")

const app = express();

const option = {
  key: fs.readFileSync("server.key"),
  cert: fs.readFileSync("ssl.cert"),
};

const server = https.createServer( app);


const getIpAddress = ()=>{
  for(let name  in os.networkInterfaces()){
    const addresses = os.networkInterfaces()[name]
    for(let data of addresses){
      if(data.family === "IPv4" && !data.internal){
         return data.address
      }
    }
  }

  return null
}

const ip =  process.env.ANNOUNCED_IP  || getIpAddress() ;
const PORT =  process.env.PORT || 3300

console.log("log", ip, PORT)

const allowedHeaders = [
  "https://localhost:3000",
  "https://localhost:3300",
  "http://localhost:3300",
  `https://${ip}:3000`,
  `https://${ip}:3300`,
  `https://mediasoup-lab.onrender.com`,
  `https://mediasoup-lab.netlify.app`
];
 
// socket
const io = new Server(server,  {
  cors: {
    origin: allowedHeaders,
  },
});

// middleware
app.use(express.static("public"))

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

app.use("*", (req, res)=>{
  res.sendFile( __dirname + "/public/index.html")
})


server.listen(PORT, () => {
  console.log("Server running on port 3300");
});

child_process.exec("curl ipinfo.io/ip", (error,stdout,stderr)=>{
  console.log(stdout, ip)
})

// mediasoup variables
let worker;

// n:n
let rooms = {};
/* 
  {
    [roomId] : {
      router: Router,
      peers: [socket],
      producerTransport: [],
      consumerTransport: []
      producerIds: [],
      consumers: []
    }
  }
*/
let peers = {};
/*
{
  [socketId] : {
    roomId: "123",
    user: {}
  }
}
*/

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: process.env.RTC_MIN_PORT || 30000,
    rtcMaxPort: process.env.RTC_MAX_PORT || 40000,
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

// create webtrc transport
const _createWebRtcTransport = async (router, callback) => {
  const webRtc__options = {
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: ip,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    iceServers: [
      {
        urls: 'stun:stun.l.google.com:19302'
      }
    ]
  };

  try {
    const transport = await router.createWebRtcTransport(webRtc__options);

    transport.on("dtlsstatechange", (dtlsstatechange) => {
      if (dtlsstatechange === "closed") {
        transport.close();
      }
    });

    transport.on("iceconnectionstatechange", (state)=>{
      console.log("ice connection change", state)
    })

    transport.on("close", (dtlsstatechange) => {
      console.log("transport closed.");
    });

    console.log("transport ", transport)
    callback({
      id: transport.id,
      iceCandidates: transport.iceCandidates,
      iceParameters: transport.iceParameters,
      dtlsParameters: transport.dtlsParameters,
    });

    return transport;
  } catch (error) {
    callback({
      error: error,
    });

    return { error };
  }
};

// socket
io.on("connection", async (socket) => {
  console.log("socket connected", socket.id);

  // create or join room
  socket.on("JOIN_ROOM", async ({ roomId, user, title }, callback) => {
    let router;

    if (!rooms[roomId]) {
      router = await worker.createRouter({ mediaCodecs });

      // create room with id
      rooms[roomId] = {};
      rooms[roomId].router = router;
      rooms[roomId].title = title;
      rooms[roomId].peers = [socket];
      rooms[roomId].producerTransports = [];
      rooms[roomId].consumerTransports = [];
      rooms[roomId].peers = [socket];
      rooms[roomId].producerIds = [];
      rooms[roomId].consumers = [];
      rooms[roomId].members = [{
        sid: socket.id,
        name: user.name,
        admin: true
      }]

      // create peer with id
      peers[socket.id] = {};
      peers[socket.id].roomId = roomId;
      peers[socket.id].user = {...user};
    } else {
      // get router and push new socket
      router = rooms[roomId].router;
      rooms[roomId].peers.push(socket);
      rooms[roomId].members.push({
        sid: socket.id,
        name: user.name,
        admin: false
      })

      // add roomId to the new peer
      peers[socket.id] = {};
      peers[socket.id].roomId = roomId;

    }

    // attach socket handlers
    newProducerSignalHandler(socket, roomId);
    userSignalHandler(roomId, "user-joined")
    socket.emit(`SIGNAL/USER/${roomId}`)

    callback({ rtpCapabilities: router.rtpCapabilities, socketId: socket.id });
  });

  // create webrtc transport
  socket.on("WEBRTC_TRANSPORT", async ({ consumer }, callback) => {
    const room = rooms[peers[socket.id].roomId];

    const transport = await _createWebRtcTransport(room.router, callback);

    if (transport.error) {
      console.log("transport/error", transport.error);
      return;
    }

    const _transport = {
      transport,
      sid: socket.id,
      id: transport.id,
    };

    if (consumer) {
      room.consumerTransports.push(_transport);
    } else {
      room.producerTransports.push(_transport);
    }
  });

  // connect producer
  socket.on("CONNECT_PRODUCER", async (dtlsParameters, transportId) => {
    try {
      const transport = getTransport("producer", socket, { id: transportId });
      transport.connect({ dtlsParameters });
    } catch (error) {
      console.log("Error/CONNECT_PRODUCER:", error);
    }
  });

  // start produce
  socket.on("START_PRODUCE", async ({ kind, rtpParameters, transportId }, callback) => {
    try {
      const producer = await getTransport("producer", socket, { id: transportId })
      .produce({
        kind,
        rtpParameters
      });
      callback(producer.id);
      addProducerId(socket.id, producer.id);
      console.log("start-produce", { kind, rtpParameters, transportId })
    } catch (error) {
      console.log("Error/START_PRODUCE:", error);
    }
  });

  // connect - consumer transport
  socket.on("CONNECT_CONSUMER", async ({ dtlsParameters, consumerId }) => {
    try {
      const transport = getTransport("consumer", socket, { id: consumerId });
      await transport.connect({ dtlsParameters });
    } catch (error) {
      console.log("Error/CONNECT_CONSUMER:", error);
    }
  });

  // start consume
  socket.on(
    "START_CONSUME",
    async ({ rtpCapabilities, remoteProducerId, consumerId }, callback) => {
      const room = rooms[peers[socket.id].roomId];
      const consumerTransport = getTransport("consumer", socket, {
        id: consumerId,
      });
      let consumer;

      try {
        const canConsume = room.router.canConsume({
          producerId: remoteProducerId,
          rtpCapabilities,
        });

        if (canConsume) {
          consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true
          });

          consumer.on("transportclose", () => {
            console.log("transport closed");
            consumerTransport.close([]);
            consumer.close();
            room.peers.forEach((_socket) => {
              _socket.emit("PRODUCER_CLOSED", { remoteProducerId });
            });
            
            removeConsumer(socket.id, consumer.id);
            removeConsumerTransport(socket.id, consumerTransport.id);
            removeProducerId(socket.id, remoteProducerId)
            
            console.log("transport closed", remoteProducerId );
          });

          consumer.on("producerclose", () => {
            consumerTransport.close([]);
            consumer.close();
            room.peers.forEach((_socket) => {
              _socket.emit("PRODUCER_CLOSED", { remoteProducerId });
            });
            
            removeConsumer(socket.id, consumer.id);
            removeConsumerTransport(socket.id, consumerTransport.id);
            removeProducerId(socket.id, remoteProducerId)
            
            console.log("producer closed",  remoteProducerId);
          });

          callback({
            consumerId: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });

          console.log("start-consume",  {
            consumerId: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });

          // add it room
          room.consumers.push({
            id: consumer.id,
            sid: socket.id,
            consumer,
          });

        }
      } catch (error) {
        console.log("Error/START_CONSUME:", error);
      }
    }
  );

  // resume consumer
  socket.on("RESUME", async ({ consumerId }) => {
    try {
      const consumer = getConsumer(socket.id, consumerId);
      await consumer.resume();
    } catch (error) {
      console.log("Error/RESUME:", error);
    }
  });

  // clean up socket
  socket.on("disconnect", () => {
    if (peers[socket.id]) {
      console.log("signal/user/disconnect")
      removeMember(socket.id)
      userSignalHandler(peers[socket.id].roomId, "user-left")

      removeProducerTransport(socket.id);
      removePeer(socket.id);
      removeConsumers(socket.id);
      removeProducerId(socket.id);

      delete peers[socket.id];
      console.log("disconnect/clean-up");
    }
  });
});

// socket utilities
/* create socket for room new joiner signal */
const newProducerSignalHandler = (socket, roomId) => {
  socket.on(`SIGNAL/NEW_PRODUCER/${roomId}`, (id) => {
    rooms[roomId].peers.forEach((_socket) => {
      _socket.emit(`NEW_PRODUCER/${roomId}`, {producerIds : rooms[roomId].producerIds, members: rooms[roomId].members});
    });
  });
};

/* new user signal handler */
const userSignalHandler = (roomId, signal)=>{
  rooms[roomId].peers.forEach((_socket)=>{
    _socket.emit("SIGNAL/USER", { members: rooms[roomId].members, signal })
  })
}

// utilities
/* get transport from room */
const getTransport = (type, socket, option) => {
  const room = rooms[peers[socket.id].roomId];
  let object;

  if (type === "consumer" && option.sid) {
    object = room.consumerTransports.find(({ sid }) => sid === option.sid);
  }

  if (type === "consumer" && option.id) {
    object = room.consumerTransports.find(({ id }) => id === option.id);
  }

  if (type === "producer" && option.sid) {
    object = room.producerTransports.find(({ sid }) => sid === option.sid);
  }

  if (type === "producer" && option.id) {
    object = room.producerTransports.find(({ id }) => id === option.id);
  }

  return object.transport;
};

/* remove producer transport from room */
const removeProducerTransport = (socketId) => {
  const room = rooms[peers[socketId].roomId];
  room.producerTransports = room.producerTransports.filter(
    ({ sid }) => sid !== socketId
  );
};

/* remove consumer and consumer transport*/
const removeConsumers = (socketId) => {
  const room = rooms[peers[socketId].roomId];
  room.consumerTransports = room.consumerTransports.filter(
    ({ sid }) => sid !== socketId
  );
  room.consumers = room.consumers.filter(({ sid }) => sid !== socketId);
};

/* remove peer socket from room */
const removePeer = (socketId) => {
  const room = rooms[peers[socketId].roomId];
  room.peers = room.peers.filter((socket) => socket.id !== socketId);
};

/* add producer id to room */
const addProducerId = (socketId, producerId) => {
  const room = rooms[peers[socketId].roomId];
  room.producerIds.push({
    sid: socketId,
    id: producerId,
  });
};

/* remove producer id to room */
const removeProducerId = (socketId, _id) => {
  const room = rooms[peers[socketId].roomId];
  if(_id){
    room.producerIds = room.producerIds.filter(({ id }) => id !== _id);
    console.log("producerIds", room.producerIds)
  }else{
    room.producerIds = room.producerIds.filter(({ sid }) => sid !== socketId);
  }
};

// get consumer
const getConsumer = (socketId, consumerId) => {
  const room = rooms[peers[socketId].roomId];
  return room.consumers.find(({ id }) => id === consumerId).consumer;
};

// remove consumer
const removeConsumer = (socketId, consumerId) => {
  const room = rooms[peers[socketId].roomId];
  room.consumers = room.consumers.filter(({ id }) => id != consumerId);
};

/* remove consumer transport*/
const removeConsumerTransport = (socketId, _id) => {
  const room = rooms[peers[socketId].roomId];
  room.consumerTransports = room.consumerTransports.filter(
    ({ id }) => id !== _id
  );
};

/* remove user data*/
const removeMember = (socketId)=>{
  const room = rooms[peers[socketId].roomId]
  room.members = room.members.filter(({sid})=> sid != socketId)
} 
