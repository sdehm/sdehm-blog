---
title: "Making a Static Blog Dynamic: Websockets and Morphdom with a Go Server"
date: 2022-12-14T10:23:47-07:00
draft: false
tags: ["go", "websockets", "morphdom", "hugo", "fly.io", "cockroachdb"]
---

## Inspiration and Introduction

Server side rendering is becoming more popular and has a number of advantages over alternatively heavy client frameworks.
One trend that has allowed server rendered content to be dynamic without serving a lot of Javascript uses a persistent websocket connection to synchronize state.
The server generates pieces of html that it sends back to the client which then is only responsible for patching the DOM with simple html.
A popular Javascript library to do this patching is [morphdom](https://github.com/patrick-steele-idem/morphdom) that aims to be lightweight and fast.

The following are frameworks that use this approach and handle a lot more complexity than will be mentioned here.
Check out their sites and documentation for more.

* [Phoenix LiveView](https://github.com/phoenixframework/phoenix_live_view)
* [Hotwire](https://hotwired.dev/)
* [Laravel Livewire](https://laravel-livewire.com/)

Static site generators such as Hugo make it easy to create and serve static web content that is easily cached and delivered cheaply.
In this post we will explore using a homegrown approach inspired by these frameworks to add dynamic content to this blog using Go and a little Javascript.

{{< lead >}}
Code for the blog is found at [github.com/sdehm/sdehm-blog](https://github.com/sdehm/sdehm-blog/tree/v0.1.0) while code for this dynamic content server is found at [github.com/sdehm/sdehm-blog-dynamic](https://github.com/sdehm/sdehm-blog-dynamic/tree/v0.1.0).
{{< /lead >}}

## Architecture Overview

The solution explored here includes a little bit of Javascript and CSS added to the static site and a single webserver written in Go.
The client side Javascript is responsible for opening the websocket connection, listening for user interaction, and patching the DOM when messages from the server are received.
The server will keep track of connections, listen for user interaction messages from the client, send messages with HTML updates to clients, and will also persist data as needed.

The stack for this implementation includes the following libraries and service providers.

* Server side websockets in Go with the [gobwas](https://github.com/gobwas/ws) websocket library
* Frontend DOM patching with [morphdom](https://github.com/patrick-steele-idem/morphdom)
* Data persisted in [CockroachDB](https://www.cockroachlabs.com/)
* Dynamic content server hosted on [Fly.io](https://fly.io/)
* The blog is a [Hugo](https://gohugo.io/) static site on GitHub Pages with the [Blowfish](https://github.com/nunocoracao/blowfish) theme

## Implementation

The dynamic components created by this implementation are a live view count and a comment section.

The live view count shows how many active connections there are on a given post.
This is shown in the top of each post page and shown per post on the [home](https://sdehm.dev) page or [posts](https://sdehm.dev/posts/) page.
The native [Blowfish](https://github.com/nunocoracao/blowfish) view count component is modified to show the live view count instead of the total view count.
{{< figure src="img/post_list.webp" title="Post List View Count" caption="Screenshot showing the live view count icon which indicates how many viewers are currently connected." >}}

The comments section shows a new comment form and a list of all comments for a given post with the newest shown at the top.
As users add comments they are updated live for anyone viewing the page.
{{< figure src="img/comments.webp" title="Post Comments" caption="Screenshot showing the comment section with a new comment form and a list of all comments the post." >}}

You can see these features on this post and others on this site.

### Client Side

The custom Javascript added to the static content is found [here](https://github.com/sdehm/sdehm-blog/blob/v0.1.0/assets/js/custom.js).
The custom CSS is found [here](https://github.com/sdehm/sdehm-blog/blob/v0.1.0/assets/css/custom.css).

#### `custom.js`

The socket's `onmessage` function set here will first parse the json sent by the server and will switch on the type.

The `connected` event sets the connection id that the server will use to identify the connection.
This message also includes the HTML content for the all of the comments for this particular post which is patched with morphdom.
Additionally an event listener is started to handle comment form submissions to be explained later.

{{< lead >}}
The Blowfish Hugo template allows creating a custom comment template which is used to create an empty placeholder div with an id of `comments` so it can be found later.
{{< /lead >}}

When the event handler receives a `morph` type event it updates the element with a matching id with server provided HTML.
Morphdom will handle diffing the changes and making the minimal updates required.
This will be used to update the live view count.

Similarly, when the message is a `prepend` type the DOM is updated with the new HTML however this time it is prepended to the element with a matching id rather than replaced with morphdom.
This allows new comments to show up at the top of the comment list.

```js
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
```

Part of the initial list of comments is a new comment form that contains __Name__ and __Comment__ fields along with a submit button so that users can submit new comments.
When a new comment form is submitted the handler sends a simple json message with the comment data to the server with the message type of `comment`.

```js
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
}
```

### Server Side

#### `main.go`

To run the server a new logger is created along with a new data repo which will connect to the CockroachDB database and wrap calls to get and persist data.

```go
func main() {
	logger := log.New(log.Writer(), "server: ", log.Flags())
	// repo := data.NewDataMock()
	connectionString := os.Getenv("COCKROACH_CONNECTION")
	repo, err := data.NewCockroachConnection(connectionString)
	if err != nil {
		logger.Fatal("unable to create cockroach repo", err)
	}
	defer repo.Close()
	server.Start(":8080", logger, repo)
}
```

#### `models.go`

These structs are used to define the application models and allow for some cleaner abstractions.
This is a little hint of Domain Driven Design that a future post will explore further.

```go
type Comment struct {
	Author    string
	Body      string
	Timestamp time.Time
}

type Post struct {
	Path     string
	Comments []Comment
}
```

#### `server.go`

The server struct stores the logger, data repo, a slice of connections, a channel for protecting updates to the connection slice, a map for quick access to connection count by the user's path, and the last connection id.
When the sever starts it registers a handler to upgrade the connection to a websocket and add a new connection when the client connects to the `/ws` endpoint.

```go
type Server struct {
	logger            *log.Logger
	repo              data.Repo
	connections       []*connection
	connectionUpdates chan func()
	connectionCounts  map[string]int
	lastId            int
}

func Start(addr string, logger *log.Logger, repo data.Repo) error {
	s := &Server{
		logger:            logger,
		repo:              repo,
		connectionUpdates: make(chan func()),
		connectionCounts:  make(map[string]int),
	}
	http.Handle("/ws", s.wsHandler())

	go s.startConnectionUpdates()
	s.logger.Printf("Listening on %s", addr)
	return http.ListenAndServe(addr, nil)
}

func (s *Server) wsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Query().Get("path")
		if !isPostListPath(path) && !isPostPath(path) {
			http.Error(w, "Invalid path", http.StatusBadRequest)
			return
		}
		conn, _, _, err := ws.UpgradeHTTP(r, w)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		go s.addConnection(conn, path)
	}
}
```

For adding a new connection we will increment a new connection id, increment our connection path map, and start a dedicated receiver goroutine for handling incoming messages.
When the connected path is a list of posts such as on the [home](https://sdehm.dev) page or [posts](https://sdehm.dev/posts/) all of the view counts listed in the post list are updated.
Otherwise, when the path is a post, the list of comments as rendered html are sent with the `connected` message to the client followed by an update to the pages view count.
All of this is wrapped in a function that is sent to the `connectionUpdates` channel so that access to the connection slice and map is synchronized.

```go
func (s *Server) addConnection(c net.Conn, path string) {
	s.connectionUpdates <- func() {
		newId := s.lastId + 1
		conn := &connection{
			id:   s.lastId,
			conn: c,
			path: path,
		}
		s.lastId = newId
		s.connectionCounts[path]++
		s.connections = append(s.connections, conn)

		id := fmt.Sprint(conn.id)

		if isPostListPath(path) {
			s.updateAllViewers(path)
		} else {
			commentsHtml, err := s.getCommentsHtml(path)
			if err != nil {
				s.logger.Println(err)
				go s.removeConnection(conn)
				return
			}
			err = conn.sendConnected(id, commentsHtml)
			if err != nil {
				s.logger.Println(err)
				go s.removeConnection(conn)
				return
			}
			s.updateViewers(path)
		}
		go conn.receiver(s)
		s.logger.Printf("New connection: %s", id)
	}
}
```

Removing a connection updates the count map, removes the connection from the slice, and updates view counts.
Like with adding a connection, this is wrapped in a function that is sent to the `connectionUpdates` channel.

```go
func (s *Server) removeConnection(c *connection) {
	s.connectionUpdates <- func() {
		for i, con := range s.connections {
			if con.id == c.id {
				con.conn.Close()
				s.connections = append(s.connections[:i], s.connections[i+1:]...)
				s.connectionCounts[c.path]--
				if s.connectionCounts[c.path] == 0 {
					delete(s.connectionCounts, c.path)
				}
				s.logger.Printf("Connection closed: %d", c.id)
				s.updateViewers(c.path)
				return
			}
		}
	}
}
```

This `startConnectionUpdates` function is a dedicated goroutine that runs in the background and waits for functions to be sent to the `connectionUpdates` channel.
When a function is received it is executed.
This forces the updates to happen one at a time.

```go
func (s *Server) startConnectionUpdates() {
	for u := range s.connectionUpdates {
		u()
	}
}
```

In order to send a message to all of the connections the `send` method is called for each one with a matching path.
If there is an error sending the message we remove the connection it.
One of the reasons this might happen is if a user closes their browser window so this is one of the ways old connections are cleaned up.

```go
func (s *Server) broadcast(m api.Message, path string) {
	for _, c := range s.connections {
		if c.path != path {
			continue
		}
		err := c.send(m)
		if err != nil {
			s.logger.Println(err)
			s.removeConnection(c)
		}
	}
}
```

To update the number of active viewers on a post page we get the number of connections for the path and render the html for the viewer count.
The function then sends the `morph` message to the client to update the html for all connections on the post page path.
The `morph` message is also sent to the client for the [home](https://sdehm.dev) page and [posts](https://sdehm.dev/posts/) page to update the viewer count there as well.
This works because the post page, [home](https://sdehm.dev) page, and [posts](https://sdehm.dev/posts/) pages all use the same HTML component with the same post specific id.
There is a little bit of defensive coding to make sure that the id is valid before sending the message; check out the [`viewersId`](https://github.com/sdehm/sdehm-blog-dynamic/blob/v0.1.0/server/server.go#L178) function in the source for more.

```go
func (s *Server) updateViewers(path string) {
	if isPostListPath(path) {
		return
	}
	viewers := s.connectionCounts[path]
	id, ok := viewersId(path)
	if !ok {
		// invalid path for the viewer count, don't update
		return
	}
	message := &api.MorphData{
		Type: "morph",
		Id:   id,
		Html: api.RenderViewers(id, viewers),
	}
	s.broadcast(message, path)
	s.broadcast(message, "/")
	s.broadcast(message, "/posts/")
}
```

The `updateAllViewers` function is similar to the `updateViewers` function but it is used for the post list pages.
It loops through all of the paths and sends the `morph` message to the client to update the viewer count for each post.

```go
func (s *Server) updateAllViewers(p string) {
	if !isPostListPath(p) {
		return
	}
	for path := range s.connectionCounts {
		if isPostListPath(path) {
			continue
		}
		id, ok := viewersId(path)
		if !ok {
			// invalid path for the viewer count, don't update
			continue
		}
		s.broadcast(&api.MorphData{
			Type: "morph",
			Id:   id,
			Html: api.RenderViewers(id, s.connectionCounts[path]),
		}, p)
	}
}
```

#### `connection.go`

The `connection` struct wraps up a `net.Conn` websocket connection along with the id and the path it was opened on.
It also has a `send` method that sends a message to the client and a dedicated `sendConnected` method to send an initial message to a new client.

```go
type connection struct {
	id   int
	conn net.Conn
	path string
}

// Send a message to the client to indicate that the connection was successful
func (c *connection) sendConnected(id string, commentsHtml string) error {
	return c.send(&api.Connected{
		ConnectionId: c.id,
		Html:         commentsHtml,
	})
}

// Serialize the data to JSON and send it to the client
func (c *connection) send(m api.Message) error {
	if c.conn == nil {
		return fmt.Errorf("connection is nil")
	}
	data, err := m.Marshal()
	if err != nil {
		return err
	}
	err = wsutil.WriteServerText(c.conn, data)
	if err != nil {
		return err
	}
	return nil
}
```

When a new connection is created, a dedicated goroutine is started to handle receiving messages from the client.
The `receiver` loops forever reading messages from the client.
The `wsutil.ReadClientData` call will block until a message is received which prevents the loop from becoming busy.
If this call returns an error, such as if the connection has closed, we will remove the connection from the server which prevents the goroutine from leaking.

{{< lead >}}
An earlier version of this did not break out of this loop and leaked memory.
{{< /lead >}}

The client sends a regular heartbeat message to keep the connection alive which is ignored here.
If the message received is a comment it is added to the database and the `broadcast` method is called to send the comment to all of the connections on the post page.

```go
func (c *connection) receiver(s *Server) {
	defer c.conn.Close()

	for {
		data, _, err := wsutil.ReadClientData(c.conn)
		if err != nil {
			s.removeConnection(c)
			return
		}
		commentData := struct {
			Type    string `json:"type"`
			Author  string `json:"author"`
			Comment string `json:"comment"`
		}{}
		err = json.Unmarshal(data, &commentData)
		if commentData.Type == "heartbeat" {
			continue
		}
		if err != nil || commentData.Type != "comment" {
			s.logger.Println("Invalid data received from client, err: ", err)
			continue
		}
		comment, err := s.repo.AddComment(c.path, sanitize(commentData.Author), sanitize(commentData.Comment))
		if err != nil {
			s.logger.Println(err)
			continue
		}
		s.broadcast(&api.MorphData{
			Type: "prepend",
			Id:   "comment_list",
			Html: api.RenderComment(*comment),
		}, c.path)
	}
}
```

#### `api.go`

An interface is defined to gain some type safety when sending messages to the client while allowing for different message types.
This looks like a lot of boiler plate here but it presents a simple api and abstracts the serialization.
The result resembles a union type with an extra `type` field to maintain the type information through serialization to the client.
While the `Marshal` terminology here hints at JSON, any serialization method could be swapped without changing code for users of this package.

```go
type Message interface {
	Marshal() ([]byte, error)
}

type messageData struct {
	Type string `json:"type"`
	Id   string `json:"id"`
	Html string `json:"html"`
}

type Morph struct {
	messageData
}

func NewMorph(id, html string) *Morph {
	return &Morph{
		messageData: messageData{
			Id:   id,
			Html: html,
		},
	}
}

func (m *Morph) Marshal() ([]byte, error) {
	m.Type = "morph"
	return json.Marshal(m)
}

type Prepend struct {
	messageData
}

func NewPrepend(id, html string) *Prepend {
	return &Prepend{
		messageData: messageData{
			Id:   id,
			Html: html,
		},
	}
}

func (p *Prepend) Marshal() ([]byte, error) {
	p.Type = "prepend"
	return json.Marshal(p)
}

type Connected struct {
	messageData
}

func NewConnected(id, html string) *Connected {
	return &Connected{
		messageData: messageData{
			Id:   id,
			Html: html,
		},
	}
}

func (c *Connected) Marshal() ([]byte, error) {
	c.Type = "connected"
	return json.Marshal(c)
}

```

#### `rendering.go`

The `api` package is also responsible for converting data from the models to HTML to be sent to the client.
This file contains simple string templates along with functions that populate their placeholders.
By defining these templates here we can control most of the dynamic UI content without changing anything on the static site.
Some coordination must be done between the client and server but by defining clear lines between the static and dynamic content this effort is minimized.

The view count component is handled similarly but is not shown in this post.

```go
const commentTemplate = `<div>
<hr class="border-dotted border-neutral-300 dark:border-neutral-600">
<div class="comment">
	<div class="comment-author font-bold text-xs text-neutral-500 dark:text-neutral-400"> %s </div>
	<span class="comment-date mt-[0.1rem] text-xs text-neutral-500 dark:text-neutral-400"> 
		<time datetime="%s"> %s </time> 
	</span>
	<div class="comment-body"> %s </div>
</div>
</div>`

func RenderComment(c models.Comment) string {
	tf := c.Timestamp.Format("2 January 2006")
	return fmt.Sprintf(commentTemplate, c.Author, c.Timestamp, tf, c.Body)
}

func RenderPostComments(p models.Post) string {
	var html string
	for _, c := range p.Comments {
		// prepend rendered comment to html
		html = RenderComment(c) + html
	}
	return fmt.Sprintf(postTemplate, html)
}
```


### Persistance

#### `data.go`

In order to save comments and allow persistance of any other relevant data, a database is needed.
CockroachDB was chosen for this project because it has a generous free plan and is easy to set up with a postgres compatible api.
It also has some nice distributed features that could be useful in the future.
To allow for easy switching between different databases, an interface is defined to hide the implementation details.

{{< lead >}}
Initially a mock implementation was created to allow for testing without a database.
This can still be found at [data/data_mock.go](https://github.com/sdehm/sdehm-blog-dynamic/blob/v0.1.0/data/data_mock.go).
{{</ lead >}}

```go
type Repo interface {
	GetPost(path string) (*models.Post, error)
	AddComment(string, string, string) (*models.Comment, error)
}
```

#### `cockroach.go`

The `Cockraoch` struct stores a `pgx.Conn` connection to the database and the context used by this connection.

```go
type Cockroach struct {
	conn *pgx.Conn
	ctx  context.Context
}
```

Some DTO structs are defined in order to represent the database models since they differ slightly from our application models.
This pattern is more common in less flexible languages but it helps keep the persistance layer separate from the application logic.
If we were using an ORM this would be even more necessary to define the actual database models.

{{< lead >}}
Note that there is no `Id` field in the application [models](#modelsgo) since they are treated as value objects but relational data likes dedicated identifiers.
This also opens up future possibilities for allowing users to edit their comments.
{{< /lead >}}

```go
type commentDTO struct {
	Id        uuid.UUID
	Author    string
	Body      string
	CreatedAt time.Time
}

type postDTO struct {
	Id   uuid.UUID
	Path string
}
```

A new instance of this struct is created by providing the connection string to this constructor function.
This allows the caller to specify the configuration details required for the connection which in this case is done in `main`.
For now all errors here are logged as fatal which will crash the application.
Since this is only called once at startup this is acceptable but in the future it would be better to return the errors and handle them in the caller.

```go
func NewCockroachConnection(connectionString string, ctx context.Context) (*Cockroach, error) {
	// get connection string from environment variable
	config, err := pgx.ParseConfig(connectionString)
	// TODO: return the errors rather than log fatal
	if err != nil {
		log.Fatal(" failed to parse config", err)
	}
	config.RuntimeParams["database"] = "blog"
	config.RuntimeParams["user"] = "blog"
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		log.Fatal("failed to connect database", err)
	}
	return &Cockroach{conn: conn, ctx: ctx}, nil
}
```

To get a post from the database, as defined in the `Repo` api, the post path is used to query the `posts` table which is joined on the `comments` table to get all of the comments for the post.
The results are scanned and converted to the application models by way of the DTO objects defined previously.

```go
func (c *Cockroach) GetPost(path string) (*models.Post, error) {
	sql := `SELECT p.id, p.path, c.id, c.author, c.body, c.created_at
			FROM posts p
			LEFT JOIN comments c ON p.id = c.post_id
			WHERE p.path = $1`
	rows, err := c.conn.Query(c.ctx, sql, path)
	if err != nil {
		return nil, fmt.Errorf("failed to get post: %w", err)
	}
	defer rows.Close()
	var post postDTO
	comments := []models.Comment{}
	for rows.Next() {
		var comment commentDTO
		err := rows.Scan(&post.Id, &post.Path, &comment.Id, &comment.Author, &comment.Body, &comment.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		comments = append(comments, models.Comment{
			Author:    comment.Author,
			Body:      comment.Body,
			Timestamp: comment.CreatedAt,
		})
	}
	return &models.Post{
		Path:     post.Path,
		Comments: comments,
	}, nil
}
```

The rest of the methods work in similar manner to insert new comments and post records into the database.

## Hosting and Deployment

[Fly.io](https://fly.io/) was chosen to host this application due to the generous free tier and easy deployment similar to CockroachDB.
There are also some nice distributed features and great support for websocket based applications.
[Fly.io](https://fly.io/) is a popular option for hosting [Phoenix LiveView](https://github.com/phoenixframework/phoenix_live_view) applications for example.
The [documentation](https://fly.io/docs/languages-and-frameworks/golang/) for deploying Go applications provides a great resource.
The only adjustment needed was to bump up the concurrency limit since the default is too restrictive and our lightweight application can handle many more connections.
Logs and a Grafana dashboard are provided which is useful for debugging and monitoring.

## Conclusion

This approach to dynamic content on a static site allows for a lot of flexibility and is enjoyable to work with.
Having a persistent websocket connection opens up a lot of possibilities for real time dynamic content yet it remains fairly lightweight.
The native features of the Go language make it easy to implement a simple websocket server that can handle many connections.

As a potential downside, websockets are pretty well established but there is still the potential of clients who do not support them or have reasons to disable them.
If a user is not online then they will only receive the static content which makes it important to make sure that the static content can deliver appropriate value by itself.

## Areas of Improvement and Next Steps

A notable area of improvement is the lack of tests in this example.
It would be interesting to see how the architecture and design changes when tests are added.

A complete list of improvements and next steps includes:

* Tests
* Defined contract for messages and code generation for client and server code.
* Better error handling
* Observability
* Markdown comments
* Cached data store
* GitHub Actions deployments
* Advanced websockets features such as compression
* Non-websocket fallback for more robust support
