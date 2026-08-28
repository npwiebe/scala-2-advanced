# Lesson 8 — Concurrency Intro (JVM Threads)

Source: `src/lectures/part3concurrency/Intro.scala`

Everything so far has been single-threaded: one instruction happens after
another, in the order you wrote them. This lesson breaks that assumption.
JVM threads let multiple pieces of code run *literally at the same time*
(or at least, in an order the JVM/OS chooses) — which is powerful, but it
means you lose the guarantee that your code runs top-to-bottom.

## 1. `Runnable` and `Thread` — starting real parallel work

```scala
val runnable = new Runnable {
  override def run(): Unit = println("Running in parallel")
}
val aThread = new Thread(runnable)

aThread.start() // gives the signal to the JVM to start a JVM thread
runnable.run()  // doesn't do anything in parallel!
aThread.join()  // blocks until aThread finishes running
```
(lines 16–24)

`Runnable` is a plain Java interface with one abstract method, `run()`
(spelled out in the comment on lines 10–14). A `Thread` wraps a `Runnable`
and, when you call `.start()`, asks the JVM to spin up an actual OS-level
thread that executes `run()` independently of the thread that called
`start()`.

The two easy-to-confuse calls:
- `aThread.start()` — schedules `run()` to execute on a *new* thread. This is
  the only way to get real parallelism.
- `runnable.run()` — just an ordinary method call. It runs on whichever
  thread calls it (here, the main thread), synchronously, like any other
  method. Calling `.run()` directly is a common beginner mistake: it looks
  identical but does nothing in parallel.
- `aThread.join()` — blocks the calling thread until `aThread` finishes.
  Without `join()`, the main thread (and the whole JVM, in a simple `App`)
  might exit before the spawned thread even gets a chance to print anything.

## 2. SAM conversion for `Runnable` — the lambda shorthand

```scala
val threadHello = new Thread(() => (1 to 5).foreach(_ => println("hello")))
val threadGoodbye = new Thread(() => (1 to 5).foreach(_ => println("goodbye")))
```
(lines 26–27)

This is Lesson 1's **SAM conversion** trick (see `01-dark-sugars.md`, §2) in
action: `Runnable` has exactly one abstract method (`run`), so Scala lets
you pass a lambda `() => ...` directly where a `Runnable` is expected,
instead of writing `new Runnable { override def run() = ... }` explicitly.
It's exactly the same mechanism the lesson used `Runnable` itself to
illustrate — this file is where that trick actually gets used for real.

## 3. Thread scheduling is non-deterministic

```scala
//  threadHello.start()
//  threadGoodbye.start()
// different runs produce different results!
```
(lines 28–30)

If you start both threads, you cannot predict the exact interleaving of
"hello" and "goodbye" lines in the output. The JVM asks the OS to schedule
threads, and the OS makes no promises about order or fairness beyond "every
started thread eventually runs." Run the same program ten times and you can
get ten different interleavings. This unpredictability is the root cause of
almost every concurrency bug — code that "usually works" can still be wrong.

**Gotcha:** non-determinism doesn't mean *random* in the sense of "equally
likely" — it means "not guaranteed," and it can be influenced by things you
don't control (CPU load, JIT warmup, number of cores). A bug that shows up
1 time in 10,000 runs is still a bug.

## 4. Executors / thread pools

```scala
val pool = Executors.newFixedThreadPool(10)
pool.execute(() => println("something in the thread pool"))
...
pool.shutdown()
println(pool.isShutdown) // true
```
(lines 32–52)

Creating a raw `Thread` for every task is expensive (each one is a real OS
thread). `Executors.newFixedThreadPool(10)` creates a reusable pool of 10
threads; `pool.execute(runnable)` hands a task to whichever pool thread is
free, instead of you managing `Thread` objects by hand. `pool.shutdown()`
stops the pool from accepting new tasks — submitting after shutdown throws
an exception on the *calling* thread (the commented-out line 49). This is
the standard production pattern; raw `new Thread(...)` calls are mostly for
teaching the mechanism.

## 5. Race conditions: shared mutable state

```scala
def runInParallel = {
  var x = 0

  val thread1 = new Thread(() => { x = 1 })
  val thread2 = new Thread(() => { x = 2 })

  thread1.start()
  thread2.start()
  println(x)
}
```
(lines 54–68)

Both threads write to the *same* variable `x`. Because `start()` doesn't
wait for the thread to finish, `println(x)` on the main thread can run
before, after, or in between the two writes. So `x` printed here could be
`0`, `1`, or `2` depending purely on scheduling luck. This is a **race
condition**: the correctness of the result depends on the relative timing
of independent threads, which the language gives you no control over.

The bank account example makes the stakes concrete:

```scala
class BankAccount(@volatile var amount: Int) {
  override def toString: String = "" + amount
}

def buy(account: BankAccount, thing: String, price: Int) = {
  account.amount -= price // account.amount = account.amount - price
}
```
(lines 73–81)

`account.amount -= price` is *not* one atomic operation — it's really
"read `amount`, subtract `price`, write the result back." With two threads
both buying from the same account (line 84–93, commented out), you can get:

```
thread1 (shoes):  reads amount = 50000, computes 47000
thread2 (iphone): reads amount = 50000, computes 46000  <- also read the OLD value
thread2 writes 46000, overwriting whatever thread1 wrote
```
(lines 95–100)

Both purchases "happened," but only one discount is reflected in the final
balance — money effectively vanishes or reappears depending on write order.
The expected final amount (`50000 - 3000 - 4000 = 43000`) is sometimes
wrong (`println("AHA: " + account.amount)` on line 91 catches the
mismatch), purely because the read-modify-write sequence on `amount` isn't
protected from interleaving.

## 6. `@volatile` vs `synchronized`

Two different fixes appear in the file:

```scala
class BankAccount(@volatile var amount: Int) { ... }   // line 73

def buySafe(account: BankAccount, thing: String, price: Int) =
  account.synchronized {
    // no two threads can evaluate this at the same time
    account.amount -= price
    println("I've bought " + thing)
    println("my account is now " + account)
  }
```
(lines 102–109)

- **`@volatile`** on a `var` guarantees that reads/writes to that field go
  straight to main memory rather than being cached per-thread/per-core, so
  every thread sees the latest write. It fixes *visibility* — but it does
  **not** make a compound operation like `amount -= price` atomic. Two
  threads can still both read the same "old" value before either writes,
  exactly as shown above. `@volatile` alone does not fix this bank account
  race.
- **`account.synchronized { ... }`** wraps a block so that only one thread
  at a time can be executing it *on that object* — any other thread calling
  `account.synchronized { ... }` blocks until the first one finishes. This
  makes the whole read-modify-write sequence atomic with respect to other
  threads synchronizing on the same account, which is what actually
  prevents the lost-update bug. `buySafe` (unlike `buy`) is race-free.

**Gotcha:** `synchronized` only protects against other code that also
synchronizes on the *same* object. If some other method mutates
`account.amount` without going through `synchronized`, the protection is
gone — locking is cooperative, not automatically enforced everywhere.

## 7. The "sleep fallacy"

```scala
var message = ""
val awesomeThread = new Thread(() => {
  Thread.sleep(1000)
  message = "Scala is awesome"
})

message = "Scala sucks"
awesomeThread.start()
Thread.sleep(1001)
awesomeThread.join()
println(message)
```
(lines 156–166)

It's tempting to think: "the main thread sleeps 1ms longer than the worker
thread sleeps, so by the time the main thread wakes up, the worker must
have already set `message`." The comment block (lines 167–184) explains why
that reasoning is unsafe: `Thread.sleep` only guarantees the thread sleeps
*at least* that long — the OS can give the CPU to some other, unrelated
thread for an arbitrary amount of extra time after the sleep ends, in
either thread. So the main thread's `println` can still run before the
worker thread's assignment, purely because the OS delayed resuming one of
them. In practice `message` is "Scala is awesome" almost every time — but
"almost always" is not "guaranteed," and `synchronized` does **not** fix
this particular problem either (line 187): synchronization prevents
*concurrent* access to a shared resource, it does not enforce *ordering*
between two independent sleeps. The correct fix for "wait until this other
thread has produced a result" is `join()`, not `sleep()` guesswork — notice
the example already calls `join()`, but only *after* the racy `println`
already happened relative to the sleep durations, which is precisely the
trap.

## Key takeaway

A JVM `Thread` wrapping a `Runnable` (often written as a SAM lambda) is the
lowest-level way to run code in parallel; `start()` launches it, `join()`
waits for it. Once two threads can touch the same mutable state, the
program's correctness depends on scheduling order the language doesn't
guarantee — that's a race condition. `@volatile` only fixes visibility of a
single field's latest value across threads; it does not make multi-step
read-modify-write sequences atomic. `synchronized` blocks make a whole
critical section atomic with respect to other code synchronizing on the
same object, which is what actually prevents lost updates — but it's still
cooperative (only protects code that opts in) and it does not fix
timing/ordering bugs like the sleep fallacy, where `join()` is the correct
tool.

---

## Exercises

The file already poses these as commented exercises (lines 114–184) —
uncomment/implement and run each one a few times to observe the
non-determinism firsthand:

1. Write `inceptionThreads(maxThreads, i)` so that thread *i* starts thread
   *i+1*, waits for it to finish (`join()`), and only then prints
   `"Hello from thread #i"`. Run it with 50 threads and confirm the output
   prints in **reverse** order (thread 50's message first).
2. Start 100 threads that each do `x += 1` on a shared `var x = 0`, with no
   synchronization. Run it many times and record the range of final values
   you actually observe for `x`. Explain, in your own words, the exact
   interleaving that produces the smallest possible final value (hint: many
   threads reading the same stale `x` before any of them writes back).
3. Fix exercise 2 by wrapping the increment in a `synchronized` block on a
   shared lock object, and confirm `x` is now always exactly 100 no matter
   how many times you run it. Then try replacing the lock with only
   `@volatile` on `x` and confirm the race is *not* fixed — explain why.
