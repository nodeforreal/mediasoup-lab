# Room

***Table of contents***

- [Room](#room)
  - [Client setup](#client-setup)
  - [Join room](#join-room)
  - [Produce event and use existing producer](#produce-event-and-use-existing-producer)

## Client setup

```js
const consumerTransport = []
rtpCapabilities = rtpCapabilities
```

## Join room

```js
 socket.emit("JOIN_ROOM", (rtpCapabilities)=>{
  rtpCapabilities =rtpCapabilities
  createDevice();
 })
```

## Produce event and use existing producer

```js

  producerTransport.on("produce", ({kind, rtpParameters}, callback, errback)>{
    socket.emit("TRANSPORT_PRODUCE", {kind, rtpParameters}, (id, producerExist )=>{
      callback({ id });

      // if producer exists, then join the room.
      if(producerExist){
        getProducers()
      }

    })
  })
