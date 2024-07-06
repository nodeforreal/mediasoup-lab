# SFU Architecture

## table of contents

  1. [Get Media streams](Get-Media-streams)
  2.

## Get Media streams

1. get media streams
2. add track for producer transport

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



