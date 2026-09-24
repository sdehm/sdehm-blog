import morphdom from "morphdom";

const wsBaseUrl = "ws.sdehm.dev";
var socket;

function connect() {
  socket = new WebSocket(
    "wss://" + wsBaseUrl + "/ws?path=" + window.location.pathname
  );

  // initialize the connection id
  let connectionId = null;

  socket.onopen = () => {
    console.log("Connected to comments");
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case "connected":
        connectionId = data.connection_id;
        console.log("Connection ID: " + connectionId);
        morphdom(document.getElementById("comments"), data.html);
        const form = document.getElementById("comment-form");
        if (form) {
          form.onsubmit = handleCommentSubmit;
        } else {
          console.error("Comment form missing from WebSocket response");
        }
        break;
      case "morph":
        {
          const target = document.getElementById(data.id);
          if (target) {
            morphdom(target, data.html);
          } else {
            console.error("WebSocket update target not found:", data.id);
          }
        }
        break;
      case "prepend":
        {
          const target = document.getElementById(data.id);
          if (target) {
            const template = document.createElement("template");
            template.innerHTML = data.html;
            target.prepend(template.content);
          } else {
            console.error("WebSocket prepend target not found:", data.id);
          }
        }
        break;
    }
  };

  socket.onclose = function (e) {
    console.error("Chat socket closed unexpectedly");
    // retry
    setTimeout(() => {
      connect();
    }, 1000);
  };

  socket.onerror = function (err) {
    console.error(err);
    socket.close();
  };
}

function handleCommentSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const author = formData.get("name");
  const comment = formData.get("comment");
  if (socket.readyState !== WebSocket.OPEN) {
    console.error("Comment not sent: WebSocket is disconnected");
    return;
  }
  // clear the form
  form.reset();
  // send the comment to the server
  socket.send(
    JSON.stringify({
      type: "comment",
      author: author,
      comment: comment,
    })
  );
}

if (document.getElementById("comments")) {
  window.setInterval(function () {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "heartbeat" }));
    }
  }, 5000);

  connect();
}
