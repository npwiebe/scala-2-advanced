# Lesson 9 — Thread Communication (wait/notify, producer-consumer)

Source: `src/lectures/part3concurrency/ThreadCommunication.scala`

`synchronized` (from earlier lessons) stops threads from *stomping on each
other's data*. It doesn't help threads *coordinate* — e.g. "consumer, don't
touch this value until the producer has actually put something there." That's
what `wait()`/`notify()`/`notifyAll()` are for. This file builds the classic
producer-consumer problem from a broken naive version up to multiple
producers/consumers sharing a bounded buffer.

## 1. The problem: producer → [ ? ] → consumer

```
producer -> [ ? ] -> consumer
```
One thread (producer) computes a value and stores it somewhere; another
thread (consumer) needs to read it out — but only *after* it's there. The
container (lines 16–26) is a `SimpleContainer` holding a single `Int`.

## 2. The naive (broken) attempt: busy-waiting

```scala
val consumer = new Thread(() => {
  println("[consumer] waiting...")
  while(container.isEmpty) {
    println("[consumer] actively waiting...")
  }
  println("[consumer] I have consumed " +  container.get)
})
```
`naiveProdCons()` (lines 28–50) has the consumer spin in a tight `while` loop,
repeatedly checking `container.isEmpty`, until the producer eventually calls
`container.set(value)`. This *works*, but it's "busy-waiting": the consumer
thread burns 100% of a CPU core the entire time it's waiting, doing nothing
but polling a flag. It also has no memory-visibility guarantee across threads
without synchronization — in general you cannot safely assume one thread will
promptly see a plain-field write made by another thread. Busy-waiting is
something you want to eliminate, not just an inefficiency — it's why
`wait()`/`notify()` exist.

## 3. `wait()` and `notify()` — blocking instead of spinning

```scala
val consumer = new Thread(() => {
  println("[consumer] waiting...")
  container.synchronized {
    container.wait()
  }
  println("[consumer] I have consumed " + container.get)
})

val producer = new Thread(() => {
  println("[producer] Hard at work...")
  Thread.sleep(2000)
  val value = 42
  container.synchronized {
    println("[producer] I'm producing " + value)
    container.set(value)
    container.notify()
  }
})
```
`smartProdCons()` (lines 55–82) replaces the spin loop with `container.wait()`.
Calling `wait()` on an object:
1. **Releases the monitor lock** the calling thread currently holds on that
   object (here, `container`'s lock, acquired by entering
   `container.synchronized { ... }`).
2. **Suspends the thread** — it does no work and consumes no CPU while
   waiting. It sits in the object's wait-set until woken.
3. When another thread calls `container.notify()` (or `notifyAll()`) on the
   *same object*, one waiting thread is woken and **re-acquires the monitor
   lock before `wait()` returns**. The consumer only resumes execution past
   `container.wait()` once it has the lock back.

This is the key mechanical fact of `wait()`: it's the *only* way for a thread
to give up a lock it holds without exiting the `synchronized` block. That's
essential — if `wait()` didn't release the lock, the producer could never get
into `container.synchronized { ... }` to produce the value and call
`notify()`, and the two threads would deadlock immediately.

Gotcha: `wait()` and `notify()`/`notifyAll()` **must be called from inside a
`synchronized` block on that same object** (`container.synchronized { container.wait() }`,
`container.synchronized { container.notify() }`), or the JVM throws
`IllegalMonitorStateException`. You can only wait on / notify a monitor lock
you currently hold. This is also why the shape is always "acquire lock →
check/act on shared state → wait or notify → (block ends, lock released)" —
`wait`/`notify` are about coordinating access to state that's *already*
protected by that lock.

Gotcha: `notify()` wakes an *arbitrary* single thread from the object's
wait-set (JVM's choice, not yours) — you cannot target a specific waiter.

## 4. Scaling the buffer: producer → [ ? ? ? ] → consumer

```
producer -> [ ? ? ? ] -> consumer
```
`prodConsLargeBuffer()` (lines 90–143) generalizes from "one slot" to a bounded
`mutable.Queue[Int]` with `capacity = 3`. Both consumer and producer now run
in infinite loops with their own `Thread.sleep` pacing, and each guards its
`wait()` with an **`if`**, not a re-checked loop:

```scala
buffer.synchronized {
  if (buffer.isEmpty) {
    println("[consumer] buffer empty, waiting...")
    buffer.wait()
  }
  val x = buffer.dequeue()
  println("[consumer] consumed " + x)
  buffer.notify()
}
```
The pattern is symmetric: the consumer waits while the buffer is empty and
`notify()`s after consuming (in case the producer is waiting because the
buffer was full); the producer waits while the buffer is full and `notify()`s
after producing (in case the consumer is waiting because the buffer was
empty). Same lock (`buffer`) guards both the queue and both conditions —
that's what lets a `notify()` from one side reliably wake the other.

Gotcha: using `if` instead of `while` around `wait()` here is subtly unsafe
with more than one thread on either side — see the next section, where the
file itself switches to `while` once it adds multiple producers/consumers.

## 5. Multiple producers and consumers: why `notify()` becomes `notifyAll()`, and `if` becomes `while`

```
producer1 ->  [ ? ? ? ] -> consumer1
producer2 -----^     ^---- consumer2
```
`multiProdCons()` (lines 210–216) spins up several `Consumer` and `Producer`
threads (defined as classes at lines 155–208) sharing one buffer. Two changes
appear compared to the single-producer/single-consumer version:

```scala
while (buffer.isEmpty) {
  println(s"[consumer $id] buffer empty, waiting...")
  buffer.wait()
}
val x = buffer.dequeue() // OOps.!
println(s"[consumer $id] consumed " + x)
buffer.notifyAll()
```
- **`while` instead of `if`.** With several consumers, `notifyAll()` can wake
  more than one consumer at once. They don't all reacquire the lock
  simultaneously — they queue up for it — but each one that wakes must
  **re-check the condition**, because by the time it's your turn for the
  lock, another consumer may already have dequeued the only element. Waking
  up from `wait()` is only a *hint* that the condition might now hold, not a
  guarantee. If this used `if`, a woken consumer could call `buffer.dequeue()`
  on an empty queue — the comment `// OOps.!` on line 173 is the file
  flagging exactly this risk (the demo leaves it in place, but production
  code should treat the empty-queue call as a bug to fix, e.g. by matching
  `if` with `while`).
- **`notifyAll()` instead of `notify()`.** With multiple producers *and*
  multiple consumers waiting on the same lock, a plain `notify()` might wake
  a thread that can't actually make progress (e.g. it wakes another producer
  when a consumer just freed a slot, and that producer's own `while` check
  sends it right back to waiting) while a thread that *could* proceed stays
  asleep. `notifyAll()` wakes every waiter so each can re-check its own
  condition in the `while` loop and only the ones that should actually
  proceed do so; the rest re-block on `wait()`. This is the standard rule of
  thumb: **one waiter kind → `notify()` is fine; multiple waiter kinds/counts
  → prefer `notifyAll()` paired with a `while` re-check.**

## 6. `notifyAll()` in isolation: `testNotifyAll()`

```scala
val bell = new Object
(1 to 10).foreach(i => new Thread(() => {
  bell.synchronized {
    println(s"[thread $i] waiting...")
    bell.wait()
    println(s"[thread $i] hooray!")
  }
}).start())

new Thread(() => {
  Thread.sleep(2000)
  bell.synchronized { bell.notifyAll() }
}).start()
```
`testNotifyAll()` (lines 228–246, invoked on line 248) strips away the buffer
entirely to isolate the mechanism: ten threads all `wait()` on a shared plain
`Object` used purely as a monitor lock, and one "announcer" thread calls
`notifyAll()` after a delay, releasing all ten at once. Contrast this with
`notify()`, which would release only one of the ten per call — you'd need to
call it ten times to free everyone, and you couldn't control the order.

## 7. Beyond wait/notify: deadlock and livelock via `Friend`

The rest of the file (lines 251–289) is the exercise section's setup, not
part of the wait/notify mechanism itself, but it's worth knowing what's there
because it's a natural failure mode once you're juggling multiple locks:

```scala
def bow(other: Friend) = {
  this.synchronized {
    println(s"$this: I am bowing to my friend $other")
    other.rise(this)   // tries to acquire other's lock while holding this one
    ...
  }
}
```
If `sam.bow(pierre)` and `pierre.bow(sam)` run concurrently (lines 284–285,
commented out), each thread grabs its own object's lock first, then blocks
forever trying to acquire the other's — a **deadlock**. The `pass`/`switchSide`
methods (lines 272–289) demonstrate a **livelock**: two threads keep yielding
to each other in a loop, actively running the whole time (no thread is
blocked), yet neither ever makes real progress.

## Key takeaway

`wait()` lets a thread give up a monitor lock and suspend without spinning,
until another thread `notify()`/`notifyAll()`s the same object; the lock is
reacquired automatically before `wait()` returns. `wait`/`notify`/`notifyAll`
only make sense inside a `synchronized` block on the object being waited on —
that's the lock they operate through. With exactly one kind of waiter, `if` +
`notify()` suffices; the moment you have multiple threads racing on the same
condition (multiple producers and/or consumers), switch to `while` (to
re-check the condition after waking) and `notifyAll()` (so every candidate
gets a chance to re-check), because a woken thread is only told "something
changed," never "the condition definitely still holds for you."

---

## Exercises

1. In `smartProdCons()` (lines 55–82), what would happen if `container.wait()`
   were called *outside* the `container.synchronized` block? Run it (or trace
   through the JVM docs) and explain the exact exception you get and why the
   lock-ownership rule causes it.
2. Modify `prodConsLargeBuffer()` to use two consumers and one producer,
   keeping `notify()`/`if` (don't switch to `notifyAll()`/`while` yet). Run it
   several times and try to trigger the `// OOps.!` bug from `Consumer.run()`
   (an empty-queue `dequeue()`) — describe the interleaving that causes it.
   Then apply the `while`/`notifyAll()` fix and confirm it stops happening.
3. Using `testNotifyAll()` as a template, write a small "starting gun"
   program: one thread waits on a shared lock object, does some work,
   then re-`wait()`s in a loop (using `while(true)` around a synchronized
   wait), while a second thread calls `notify()` (not `notifyAll()`) once per
   second. Confirm the first thread wakes exactly once per notification.
