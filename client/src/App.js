import { useRef, useState } from "react";
import styled from "styled-components";
import { useNavigate, useParams } from "react-router";

import { Device } from "mediasoup-client";
import io from "socket.io-client";

import { Button, Input } from "antd";

import "./App.css";

import { customAlphabet } from "nanoid";
const nanoid = customAlphabet("abcdefghijlmnopqrstvwxyz");

const socket = io(process.env.NODE_ENV === 'production' ? "https://mediasoup-lab.onrender.com" : "https://localhost:3300");
const device = new Device();

let videoParams = {
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
let screenParams = {
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

let audioParams = {};
let consumers = [];
let producers = {}
let producerIds = [];
let remoteProducerIds = [];


function App() {
  const videoClientRef = useRef(null);
  const containerRef = useRef(null);

  const navigate = useNavigate();
  const { roomId } = useParams();
  const [hasJoined, setHasJoined] = useState(false);
  const [userName, setUserName] = useState("user id: "+ nanoid(4));
  const [title, setTitle] = useState("Dev Catch up");
  // const [socketId, setSocketId] = useState(null)

  let [videoProducerId, setVideoProducerId] = useState(null);
  let [audioProducerId, setAudioProducerId] = useState(null);
  let [screenShareProducerId, setScreenShareProducerId] = useState(null);


  let [members, setMembers] = useState([])

  /**
   * create producer transport and start produce
   */
  const createProducerTransport = async (stream, mediaParams) => {

    // emit - create webrtc transport
    socket.emit("WEBRTC_TRANSPORT", { consumer: false }, async (params) => {
      if (params.error) {
        console.log("Error/create producer transport:", params);
        return;
      }

      let producerTransport = device.createSendTransport(params);

      producerTransport.on('icestatechange', (iceState) => {
        console.log(`ICE state changed:`, iceState);
      });
      
      producerTransport.on('connectionstatechange', (connectionState) => {
        console.log(`Connection state changed:`, connectionState);
      });
      
      console.log("transport parameters", params)
      // connect producer
      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            // connect send transport on server
            await socket.emit("CONNECT_PRODUCER", dtlsParameters, params.id);

            // must be invoked to tell server dtls parameter transferred
            callback();
          } catch (error) {
            console.log("Error/producer transport on connect:", error);
            errback(error);
          }
        }
      );

      // start produce
      producerTransport.on("produce", async (_params, callback, errback) => {
        try {
          const { kind, rtpParameters } = _params;
          await socket.emit("START_PRODUCE", { kind, rtpParameters, transportId: params.id }, (id) => {
            callback({ id });

            socket.emit(`SIGNAL/NEW_PRODUCER/${roomId}`, id);
            producerIds.push(id);


            if(!producers[stream]){
              producers[stream] = {}
              producers[stream].id = id
            }

            if(stream === 'video'){
              setVideoProducerId(id)
            }
            
            if(stream === "screen"){
              setScreenShareProducerId(id)
            }

            if(stream === 'audio'){
              setAudioProducerId(id)
            }

          });
        } catch (error) {
          console.log("Error/producer transport on produce:", error);
          errback(error);
        }
      });

      let producer = await producerTransport.produce(mediaParams);

      producers[stream].producer = producer
      producers[stream].transport = producerTransport

      producer.on("trackended", () => {
        console.log("stream ended.");
      });

      producer.on("transportclose", () => {
        console.log("transport closed.");
      });

    });
  };

  /**
   * create consumer transport and start consume
   */
  const createConsumerTransport = (remoteProducerId, socketId) => {
    socket.emit("WEBRTC_TRANSPORT", { consumer: true }, async (params) => {
      if (params.error) {
        console.log("Error/create consumer transport:", params);
        return;
      }

      let consumerTransport = device.createRecvTransport(params);

      // consumer transport on connect
      consumerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await socket.emit("CONNECT_CONSUMER", {
              consumerId: params.id,
              dtlsParameters,
            });
            callback();
          } catch (error) {
            errback(errback);
          }
        }
      );

      // start consume
      socket.emit(
        "START_CONSUME",
        {
          rtpCapabilities: device.rtpCapabilities,
          remoteProducerId: remoteProducerId,
          consumerId: params.id,
        },
        async (params) => {
          let consumer = await consumerTransport.consume({
            producerId: params.producerId,
            id: params.consumerId,
            rtpParameters: params.rtpParameters,
            kind: params.kind,
          });

          const { track } = consumer;

          // add consumer and transport
          consumers.push({
            remoteProducerId: remoteProducerId,
            consumerId: params.consumerId,
            consumer,
            transport: consumerTransport,
          });

          if (params.kind === "video") {
            const _video = document.querySelector(`video#${btoa(params.consumerId)}`);
            if (!_video) {
              const video = document.createElement("video");
              video.autoplay = true;
              video.id = btoa(params.consumerId);
              video.srcObject = new MediaStream([track]);
              console.log("socketId", socketId)
              const user = document.getElementById(socketId)
              user.appendChild(video);
            }
          }

          if (params.kind === "audio") {
            const _audio = document.querySelector(`audio#${btoa(params.consumerId)}`);
            if (!_audio) {
              const audio = document.createElement("audio");
              audio.autoplay = true;
              // audio.controls = true;
              audio.id = btoa(params.consumerId);
              audio.srcObject = new MediaStream([track]);
              containerRef.current.appendChild(audio);
            }
          }

          // resume stream
          socket.emit("RESUME", { consumerId: params.consumerId });
        }
      );
    });
  };

  /**
   * create room and join
   */
  const createRoomId = async () => {
    const start = nanoid(3);
    const middle = nanoid(4);
    const end = nanoid(3);
    const _roomId = `${start}-${middle}-${end}`;

    // if room does not exist create and navigate to new room id
    if (!roomId) {
      navigate(`/room/${_roomId}`);
      return;
    }

    if (hasJoined) return;

    // attach new member trigger socket
    socket.on(`NEW_PRODUCER/${roomId}`, ({producerIds: _producerIds }) => {
      console.log("new-producers", _producerIds);
      _producerIds.forEach(({ id, sid }) => {
        if (!producerIds.includes(id) && !remoteProducerIds.includes(id)) {
          remoteProducerIds.push(id);
          createConsumerTransport(id, sid);
        }
      });
    });

    // attach member left socket
    socket.on("PRODUCER_CLOSED", ({ remoteProducerId }) => {
      const consumerData = consumers.find(({ remoteProducerId: id }) => id === remoteProducerId);

      if (consumerData) {
        const { consumer, transport } = consumerData;
        consumer.close();
        transport.close();

        // clean up
        consumers = consumers.filter(({ id }) => id !== remoteProducerId);
        remoteProducerIds = remoteProducerIds.filter((id) => id !== remoteProducerId);

        // remove elements
        const video = document.querySelector(`video#${btoa(consumer.id)}`);
        const audio = document.querySelector(`audio#${btoa(consumer.id)}`);

        // clean up dom
        if (video) {
          video.remove();
        }
        if (audio) {
          audio.remove()
        }
      }
    });


    /* attach users - event socket */
    socket.on("SIGNAL/USER", ({members, signal, socketId })=>{
      setMembers(members)
      console.log("members", members, signal)
      if(signal === "user-left"){
        // navigate("/")
      }
    })



    try {
      socket.emit(
        "JOIN_ROOM",
        { roomId, user: { name: userName }, title },
        async (params) => {
          let rtpCapabilities = params.rtpCapabilities;
          await device.load({
            routerRtpCapabilities: rtpCapabilities,
          });

          setHasJoined(true);
          // setSocketId(params.socketId)
          socket.emit(`SIGNAL/NEW_PRODUCER/${roomId}`);
          console.log("rtp capabilities", rtpCapabilities);
        }
      );
    } catch (error) {
      console.log("error/createRoom");
    }
  };


  /* stream video, audio and screen */
  const streamMedia = async (type)=>{

    let mediaStream;
    let screenShare;
    let mediaParams;

    // get medias
    try{
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 1080 ,
          height: 960
        },
        audio: true
      })
    }catch(error){
      alert(error)
      return ;
    }

    if(type === "video"){
      videoClientRef.current.srcObject = new MediaStream(mediaStream.getVideoTracks())
      mediaParams = {
        ...videoParams,
        track: mediaStream.getVideoTracks()[0]
      }
    }

    if(type === "audio"){
      mediaParams = {
        ...audioParams,
        track:  mediaStream.getAudioTracks()[0]
      }
    }
    
    if(type === "screen"){
      try{
        screenShare = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        })

        mediaParams = {
          ...screenParams,
          track: screenShare.getVideoTracks()[0]
        }
      }catch(error){
        alert(error)
        return ;
      }
    }

    createProducerTransport(type, mediaParams)
    console.log('mediaStream', mediaStream)
  }

  /* close streams */
  const closeStream = (stream)=>{
    if(producers[stream]){
      producers[stream].producer.close()
      producers[stream].transport.close()
      remoteProducerIds = remoteProducerIds.filter((id) => id !== producers[stream].id)

      if(stream === "video"){setVideoProducerId(null)}
      if(stream === "audio"){setAudioProducerId(null)}
      if(stream === "screen"){setScreenShareProducerId(null)}
      
      console.log("close-stream", producers[stream])
    }
  }

  return (
    <Container>
      <section className="videos-container" ref={containerRef}>
        <video ref={videoClientRef} autoPlay className="client-video" style={{ display: videoProducerId ? "block" : "none"}}></video>
      </section>

      <hr />

      <section className="execute-buttons-container">
        <section>
          <Input
            value={userName}
            placeholder="Enter your name"
            onChange={(e) => {
              setUserName(e.target.value);
            }}
          />
          <Input
            value={title }
            placeholder="Enter your room name"
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />

          <Button
            type="primary"
            onClick={createRoomId}
            disabled={hasJoined}
            size="medium"
          >
            {roomId ? (hasJoined ? "Joined" : "Join Room") : "Create Room"}
          </Button>
        </section>
        <section>
          <Button
            type="default"
            onClick={()=>{videoProducerId ? closeStream("video") : streamMedia('video')}}
            disabled={!hasJoined}
            size="medium"
          >
            Video - {videoProducerId ? "ON" : "OFF"}
          </Button>
          <Button
            type="default"
            onClick={()=>{audioProducerId ? closeStream("audio") : streamMedia('audio')}}
            disabled={!hasJoined}
            size="medium"
          >
            Audio - {audioProducerId ? "ON" : "OFF"}
          </Button>
          <Button
            type="default"
            onClick={()=>{screenShareProducerId ? closeStream("screen") : streamMedia('screen')}}
            disabled={!hasJoined}
            size="medium"
          >
            Screen - {screenShareProducerId ? "ON" : "OFF"}
          </Button>
        </section>
      </section>
      
      <hr />

      <section className="members-container">
        {
          members.map((member, index)=>{
            return (
              <article key={`member-${index}`} className="member-wrapper" id={member.sid}>
                <h3>{member.name}</h3>
                <p>{member.admin ? "Admin" : "Member"}</p>
              </article>
            )
          })
        }
      </section>
    </Container>
  );
}

const Container = styled.div`
  padding: 1rem;

  .videos-container {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.2rem;
    video {
      width: 100%;
      aspect-ratio: 16/9;
      border-radius: 8px;
    }
  }

  video.client-video{
    width: 320px;
    height: 180px;

    position: fixed;
    z-index: 9999;
    bottom: 1rem;
    right: 1rem;

    object-fit: cover;

    &:active {
      cursor: move;
    }
  }
 
  @media screen and (max-width: 560px) {
    grid-template-columns: repeat(1, minmax(0, 1fr));
  }

  .btn-container {
    margin-top: 1rem;
    text-align: center;
  }

  .execute-buttons-container {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .execute-buttons-container section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  hr {
    border: 0;
    border-bottom: 1px dashed #d5d5d5;
    margin: 1rem;
  }

  .members-container{
    height: calc(100vh - 300px);
    border-radius: 1rem;
    background-color: #d5d5d54d;

    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    grid-template-rows: repeat(auto-fit, minmax(0, 1fr));
    column-gap: 1rem;
  }
  
  .member-wrapper{
    padding: 1rem;
    background-color: rgb(2, 0, 73, 0.1);
    border-radius: 0.5rem;

    display: grid;
    place-content: center;

    video{
      width: 100%;
    }
  }
`;

export default App;
