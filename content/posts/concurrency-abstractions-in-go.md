---
title: "Concurrency Abstractions in Go"
date: 2022-10-09T14:51:19-06:00
draft: true
tags: ["go", "concurrency"]
---

# Introduction

Concurrency is built in to the Go programming language and is one of its most popular features.
There are many great resources to learn more about how concurency works out of the box in Go this post will instead explore some alternative abstractions borrowed from other languages as implememted in Go.

Note that one of the other powerful features of Go is that it does not rely on as many abstractions as other languages and is typically used to directly address particular problems.
The patterns presented here are more for learning and exploring with comparisons to other languages rather than for actual use.

Code for this post can be found at [github.com/sdehm/go-concurrency-abstractions](https://github.com/sdehm/go-concurrency-abstractions).

## Go Concurrency Fundamentals

This section will describe some of the fundamentals and primatives for concurrency in Go.
There are essentially two primatives that enable writing cocurrent code in Go: `goroutines` and `channels`.
Only basic descriptions of these primatives will be covered here so please check other resources for more detailed explainations.

### Goroutines

A `goroutine` is a lightweight, virtual process that is managed by the Go runtime.
`Goroutines` are lighter weight than threads in other languages and are created by calling the `go` keyword followed by a function call.
For example: 
```go
go func say() {
  fmt.Println("Hello, World!")
}()
```
This code snippet will create a new `goroutine` that will print "Hello, World!" to the console in the background.
It is important to note that `goroutines` on their own do not provide any way to wait for execution to complete or to communicate with other `goroutines`.
Everything in Go is run as a `goroutine` including `main` which will actually close when the program exits.
Any other `goroutines` that are still running will be terminated as well.

### Channels

Channels provide a mechanism for `goroutines` to communicate with each other.
This allows data to be passed in and out of `goroutines` and for `goroutines` to wait for data to be available.
They also allow for synchronization of `goroutines` to ensure that they are executed in a particular order.

## Built-in Concurrency Abstractions

### WaitGroups

### Mutexes

## Task Abstraction

## Work Queues

## Events

## Actor Model