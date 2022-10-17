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
Unfortunately we would need to create a new version of these functions and wrapper structs for every variation.
If we were building a library we would not want to create a new function for every possible number of arguments.
Code generation and reflection could help solve this but we won't explore that now.

## Work Queues

Channels in Go are basically queues so a work queue concurrency abstraction makes sense and can be more idiomatic than some of these other patterns.
A work queue is a queue of tasks that are executed by a pool of workers.
The number of workers should be configurable and typically makes sense to set to the number of CPU cores.
An example work queue implementation is shown below.

```go
// workers.go
type Workers[T any] struct {
	Work chan func() T
	Results chan T
	wg sync.WaitGroup
}

func New[T any](numWorkers int) *Workers[T] {
	w := &Workers[T]{
		Work: make(chan func() T),
		Results: make(chan T),
		wg: sync.WaitGroup{},
	}

	for i := 0; i < numWorkers; i++ {
		w.wg.Add(1)
		go func() {
			for f := range w.Work {
				w.Results <- f()
			}
			w.wg.Done()
		}()
	}

	// Close the results channel when the work is done.
	go func() {
		w.wg.Wait()
		close(w.Results)
	}()

	return w
}
```

In this example we create a `Workers` struct that has a `Work` channel for tasks and a `Results` channel for results.
The struct has a generic type parameter to allow a variety of result types.
We could allow for input arguments explicitly here but our earlier trick of using closures works here as well since we are using a function as the work item type.
The struct also stores a wait group to manage synchronization of the workers so that we can close the results channel when all the work is done.
The constructor for this struct accepts a number of workers to create and starts a go routine for each worker that is listening to work channel to take on work as it comes in.
As work is performed the result is sent to the results channel.
The following shows how this can be used.

```go
w := workers.New[string](2)
go func() {
  for i := 0; i < 10; i++ {
    i := i
    w.Work <- func() string {
      return fmt.Sprintf("%d", i)
    }
  }
  close(w.Work)
}()
for r := range w.Results {
  fmt.Println(r)
}
```

{{< lead >}}
Note that the `Workers` struct exposes a basic `Work` channel that is not buffered. 
Since the channel will block on send we must send our work items in a separate go routine that will close the channel once all work has been added.
If we knew ahead of time how much work we would have we could create a buffered channel of the appropriate size.
{{< /lead >}}

## Events

## Actor Model