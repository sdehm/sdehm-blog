import morphdom from "morphdom";

const socket = new WebSocket("ws://localhost:8080/ws");

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
  }
};

function handleCommentSubmit(event) {
  event.preventDefault();
  console.log("Submitting comment");
  const form = event.target;
  const formData = new FormData(form);
  const name = formData.get("name");
  const comment = formData.get("comment");
  console.log("Name: " + name);
  console.log("Comment: " + comment);
  // clear the form
  form.reset();
};
