---
title: "Concurrency Abstractions in Go"
date: 2022-10-09T14:51:19-06:00
draft: true
tags: ["go", "concurrency"]
---

# Introduction

Concurrency is built in to the Go programming language and is one of the most powerful features of the language.
There are many great resources to learn more about how concurrency works out of the box in Go.
This post will instead explore some alternative abstractions borrowed from other languages as implemented in Go.

Note that one of the other powerful features of Go is that it does not rely on as many abstractions as other languages and is typically used to directly address particular problems.
The patterns presented here are more for learning and exploring with comparisons to other languages rather than for actual use.

{{< lead >}}
Code for this post can be found at [github.com/sdehm/go-concurrency-abstractions](https://github.com/sdehm/go-concurrency-abstractions).
{{< /lead >}}

## Go Concurrency Fundamentals

This section will describe some of the fundamentals and primitives for concurrency in Go.
Only basic descriptions will be covered here so please check other resources for more detailed explanations.
Mutexes and atomic types are also not covered.

### Goroutines

A `goroutine` is a lightweight, virtual process that is managed by the Go runtime.
`Goroutines` are lighter weight than threads in other languages and are created by calling the `go` keyword followed by a function call.
For example: 
```go
func main() {
  go func() {
    fmt.Println("Hello, World!")
  }()
}
```
This code snippet will create a new `goroutine` that will print "Hello, World!" to the console in the background.
It is important to note that `goroutines` on their own do not provide any way to wait for execution to complete or to communicate with other `goroutines`.
Everything in Go is run as a `goroutine` including `main` which will actually close when the program exits.
Any other `goroutines` that are still running will be terminated as well.

### Channels

A channel in Go is a special data structure that behaves like a queue that can be accessed by multiple `goroutines`.
Items can be either sent into the channel or received from the channel.
Channels provide a mechanism for `goroutines` to communicate with each other.
This allows data to be passed in and out of `goroutines` and for `goroutines` to wait for data to be available.
They also allow for synchronization of `goroutines` to ensure that they are executed in a particular order.
If the example above was run in an empty program it would not print anything since the main `goroutine` would exit before the `goroutine` that prints "Hello, World!" could finish.
Channels can be used to wait for the `goroutine` to finish before exiting the program.

```go
// helloworld.go
func helloworld() {
  c := make(chan struct{})
  go func() {
    fmt.Println("Hello, World!")
    c <- struct{}{}
  }()
  <-c
}
```

{{< lead >}}
The `struct{}` type is used here since it is the smallest type in Go and does not take up any memory. Another popular option is a `bool` type.
{{< /lead >}}

In this example the data in the channel does not matter.
Instead we are using a special feature of channels that the receive operation will block until data is available.
When the empty struct is sent into the channel in the `goroutine` the receive operation in the main `goroutine` will unblock and the program will exit having printed the greeting.

Channels can also be closed which signals that no more data will be sent into the channel and any blocking receive operation should unblock.
In our example here this is not necessary since we are only sending a single item into the channel and only waiting for one item to be received.

An additional way to receive data from a channel is to use a `for` loop and the `range` keyword.
Channels can also be buffered, see this Go by Example [post](https://gobyexample.com/channel-buffering) for more details.

## Built-in Concurrency Abstractions

### WaitGroups

### Mutexes

## Task Abstraction

Many languages provide a `Task` concurrency abstraction that allows for asynchronous execution code with explicit synchronization or "awaiting".
Sometimes this behavior is called a `promise` or `future`.
It can also be implemented with `async` and `await` keywords.

### Basic Task Implementation
The following is an implementation of a `Task` abstraction in Go based loosely on .NET `Task`s.

```go
// task.go
func New(f func()) *Task {
	return &Task{
		f:       f,
		awaiter: make(chan struct{}),
	}
}

func (t *Task) Start() {
	go func() {
		t.f()
		t.awaiter <- struct{}{}
	}()
}

func (t *Task) Wait() {
	<-t.awaiter
}
```

To use this `Task` abstraction we can create a new `Task` and call `Start` to start the `Task` in a new `goroutine`.
We then call `Wait` to wait for the `Task` to complete.
If `Wait` is not called the `Task` might not complete before the program exits.
The awaiter channel is used to block the `Wait` call until the provided function has completed.

```go
t := New(func() {
  fmt.Println("Hello, World!")
})
t.Start()
t.Wait()
```

This implementation is very simple and does not provide any error handling or cancellation.
It also only implements functions that take no arguments and return no values.

### Task with Input Arguments
If we want to use a function with arguments with our `Task` we can use a closure to capture the arguments.
This example uses a similar function except the `greeting` to print is set in the outside scope and passed in as a closure.

```go
greeting := "Hello from the closure!"
t := New(func() {
  fmt.Println(greeting)
})
t.Start()
t.Wait()
```

{{< lead >}}
Note that the usual [caveats](https://github.com/golang/go/wiki/CommonMistakes#using-goroutines-on-loop-iterator-variables) about closures apply here and loop scope variables should be used with care and set as local variables when necessary.
{{< /lead >}}

### Task with Output Values
If we want to return a value from the `Task` we can also use a closure to capture the return value.
This example sets a variable in the outside scope and modifies it in the `Task` function.

```go
var greeting string
t := New(func() {
  greeting = "Hello from the closure!"
})
t.Start()
t.Wait()
fmt.Println(greeting)
```

Using closures like this works but it can be hard to determine what the actual inputs and outputs of the `Task` are.
We also need to pay more attention to the scoping of our variables than seems necessary here.

### Refactoring with Generic Helpers
We can add to our `Task` implementation to use some generic helpers to make the code more readable and easier to use.
Since we have already proven that the closure method works for input and outputs we can take advantage of that and not modify existing code.
To allow the creation of a task with a single input argument we can create the following helper function.

```go
// Creates a new task with a single input argument.
func NewWithInput[T any](f func(T), input T) *Task {
	fun := func() {
		f(input)
	}
	return New(fun)
}

// usage
t := NewWithInput(func(i string) {
  fmt.Println(i)
}, "Hello with generics!")
t.Start()
t.Wait()
```

This helper function takes a function that takes a single argument and a value to pass into that function.

To allow a task to return a value we must slightly modify the `Task` struct to store the return value.
We also create a new constructor function to simplify creation of the new struct and a getter function to get the result after blocking on the execution of the task.

```go
// Task struct that stores a single result value.
type TaskWithResult[T any] struct {
	Task
	result T
}

// Creates a new task that stores a single result value.
func NewWithResult[T any](f func() T) *TaskWithResult[T] {
	t := &TaskWithResult[T]{
		Task: *New(nil),
	}
	t.f = func() {
		t.result = f()
	}
	return t
}

// Returns the result value after waiting for the task to finish.
func (t *TaskWithResult[T]) GetResult() T {
	t.Wait()
	return t.result
}
```

This new constructor closes over its own container struct in order to store the result value.
Using these new features are straightforward and shown in the following example.
`GetResult` is called rather than `Wait` so that we get the result value after the task has finished.

```go
t := NewWithResult(func() string {
  return "Hello with generic output!"
})
t.Start()
fmt.Println(t.GetResult())
```

These approaches can be combined based on the needed input and output tasks of the application.
Unfortunately we would need to create a new version of this function for every variation.
If we were building a library we would not want to create a new function for every possible number of arguments.
Code generation and reflection could help solve this but we won't explore that now.

We are implementing currying via closures here since Go does not officially support it directly.
Other implementations of currying in Go could be explored as alternatives.

## Work Queues

## Events

## Actor Model