import morphdom from "morphdom";

const socket = new WebSocket(
  "ws://localhost:8080/ws?path=" + window.location.pathname
);

// initialize the connection id
let connectionId = null;

socket.onopen = () => {
  console.log("Connected");
};

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "connected":
      connectionId = data.connection_id;
      console.log("Connection ID: " + connectionId);
      morphdom(document.getElementById("comments"), data.html);
      document
        .getElementById("comment-form")
        .addEventListener("submit", handleCommentSubmit);
      break;
    case "morph":
      morphdom(document.getElementById(data.id), data.html);
      break;
    case "prepend":
      template = document.createElement("template");
      template.innerHTML = data.html;
      document.getElementById(data.id).prepend(template.content);
      break;
  }
};

function handleCommentSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const author = formData.get("name");
  const comment = formData.get("comment");
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
};
