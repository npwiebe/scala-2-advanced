# Lesson 11 — Parallel Utilities

Source: `src/lectures/part3concurrency/ParallelUtils.scala`

Lessons 8-9 (`ThreadCommunication.scala`) built concurrency by hand: raw
`Thread`s, `synchronized` blocks, `wait()`/`notify()`. That's the mechanism
everything else is built on, but you'd almost never write it directly in real
code — it's tedious and easy to get subtly wrong (missed notifies, deadlocks,
livelocks — literally the exercises at the end of that file). This lesson
covers two higher-level tools the JVM/Scala ecosystem gives you so you don't
have to hand-roll locking for the common cases: **parallel collections** and
**atomic references**.

## 1. Parallel collections — `.par`

```scala
val parList = List(1,2,3).par
val aParVector = ParVector[Int](1,2,3)
```
Calling `.par` on a regular collection converts it to a parallel collection —
`List`/`Vector`/`Array`/`Map`/`Set` all have parallel counterparts (line 21-26
lists the family: `Seq`, `Vector`, `Array`, `Map` (Hash/Trie), `Set`
(Hash/Trie)). Once "parallel," operations like `map`, `flatMap`, `filter`,
`foreach`, `reduce`, and `fold` no longer run sequentially on one thread —
the runtime automatically splits the collection into chunks, runs the
operation on each chunk on a different thread (from a thread pool), and
recombines the results. This is the **map-reduce model** (lines 46-51):

1. **Split** — a `Splitter` divides the elements into chunks
2. **Operate** — each chunk gets the operation applied independently, in parallel
3. **Combine** — a `Combiner` merges the partial results back into one collection

The entire point is that you get parallelism *for free* — you don't write
any thread or lock code yourself; you just call `.par` before the operation
you already know how to write serially.

```scala
val list = (1 to 10000).toList
val serialTime   = measure { list.map(_ + 1) }
val parallelTime = measure { list.par.map(_ + 1) }
```
The file measures wall-clock time for a serial `map` vs. a parallel `map`
over 10,000 elements (lines 34-44). Parallel collections pay a real
overhead — spinning up tasks, splitting, recombining — so they're a net win
only when the per-element work is expensive enough to amortize that
overhead. For cheap operations over small collections, `.par` can be
*slower* than the plain serial version.

**Gotcha — non-associative operators and `reduce`:**
```scala
println(List(1,2,3).reduce(_ - _))       // -4, deterministic: ((1-2)-3)
println(List(1,2,3).par.reduce(_ - _))   // could be -4, 2, 0... depends on chunking
```
Serial `reduce` always combines elements left-to-right, so `_ - _` (which is
not associative — order matters) gives a predictable answer. Parallel
`reduce` combines chunks in whatever order the splitter/combiner happens to
produce, so a non-associative operator can give a **different result every
run**. Only use `.par` with operators that are associative (and ideally
commutative) — `+`, `*`, `max`, string concatenation, etc. — where chunk
order doesn't change the answer.

## 2. Race conditions inside `.par` — synchronization still matters

```scala
var sum = 0
List(1,2,3).par.foreach(sum += _)
println(sum)  // race conditions!
```
`.par` parallelizes the *iteration*, but it does nothing to protect a shared
mutable variable that multiple chunk-threads write to concurrently. `sum +=
_` is really "read `sum`, add, write `sum`" — three steps that can interleave
across threads, so `sum` can end up wrong (or occasionally right, by luck).
The lesson: parallel collections remove the need to write *your own*
splitting/combining logic, but they do **not** remove the need to reason
about shared mutable state. Anything a parallel collection's callback
touches outside the collection itself still needs the same care as
hand-written threads — either avoid shared mutable state (prefer `reduce`/
`fold`, which return a new value instead of mutating one) or protect it
(see Atomic references, below).

## 3. Configuring the parallelism — `tasksupport`

```scala
aParVector.tasksupport = new ForkJoinTaskSupport(new ForkJoinPool(2))
```
A parallel collection's `tasksupport` controls *how* the splitting/execution
actually happens — in this case, a `ForkJoinPool` with 2 worker threads, so
you can cap how much parallelism is used. The comment on lines 66-70 lists
the alternatives: `ThreadPoolTaskSupport` (deprecated) and
`ExecutionContextTaskSupport` (runs the parallel collection on a given
`ExecutionContext`, e.g. the same one you use for `Future`s). You can also
implement the `TaskSupport` trait yourself (commented out at lines 72-80) if
you need fully custom scheduling — it requires `execute`,
`executeAndWaitResult`, `parallelismLevel`, and `environment`.

## 4. Atomic references — lock-free thread-safe mutation

```scala
val atomic = new AtomicReference[Int](2)

val currentValue = atomic.get() // thread-safe read
atomic.set(4)                   // thread-safe write

atomic.getAndSet(5)             // thread-safe combo: read old, write new

atomic.compareAndSet(38, 56)
// if the CURRENT value equals 38 (reference equality), set it to 56 — otherwise no-op

atomic.updateAndGet(_ + 1)      // thread-safe: apply a function, store & return new value
atomic.getAndUpdate(_ + 1)      // same, but returns the OLD value

atomic.accumulateAndGet(12, _ + _) // thread-safe: combine current value with 12, store & return new
atomic.getAndAccumulate(12, _ + _) // same, but returns the OLD value
```
`java.util.concurrent.atomic.AtomicReference[T]` wraps a value so every
operation on it is a single, indivisible (atomic) step — no
`synchronized`/`wait`/`notify` required, and no possibility of the
read-modify-write race we just saw with `sum += _`. Under the hood, most of
these operations are implemented with hardware-supported CAS
("compare-and-swap") instructions rather than locks, which is why they're
often called **lock-free**: instead of blocking other threads while you
update the value, the JVM just retries the CAS if another thread beat you to
it.

The naming pattern is consistent and worth knowing cold:
- `get` / `set` — plain thread-safe read/write
- `getAndSet(v)` — write `v`, return the *old* value
- `compareAndSet(expected, newValue)` — the classic CAS primitive: only
  writes if the current value still equals `expected` (this is how
  lock-free algorithms avoid clobbering someone else's concurrent update)
- `updateAndGet(f)` / `getAndUpdate(f)` — apply a function to the current
  value; `updateAndGet` returns the new value, `getAndUpdate` returns the old
- `accumulateAndGet(x, f)` / `getAndAccumulate(x, f)` — combine the current
  value with an external value `x` using `f`; same old/new return
  convention as above

**Gotcha:** `compareAndSet` compares by *reference equality* for reference
types (the comment on line 93 flags this explicitly) — for a boxed `Int`
this mostly behaves like value equality in practice on the JVM due to
`Integer` caching for small values, but don't rely on that for arbitrary
objects; it's genuinely checking "is this the same object," not "is this
equal."

## Atomic vs. `synchronized`/`wait`/`notify` — when to reach for which

- **Raw threads + `synchronized`/`wait`/`notify`** (Lessons 8-9): full
  control, but you own every failure mode — forgetting to `synchronized` a
  block, deadlocking two locks acquired in different orders (the `Friend`
  example), livelocking two threads that keep politely yielding to each
  other, or missing a `notify` so a waiter sleeps forever. Use this only
  when you need custom coordination logic that the higher-level tools don't
  express (e.g. a bounded producer/consumer buffer).
- **`AtomicReference`**: the right tool for a *single shared mutable value*
  (a counter, a flag, a reference that gets swapped) that many threads read
  and update — no lock needed, no risk of deadlock, but it only protects
  that one value; it can't coordinate a sequence of operations across
  multiple pieces of state.
- **`.par` parallel collections**: the right tool when the parallelism is
  just "run this same operation over many independent elements" — you get
  splitting/scheduling/recombining for free, but you're still responsible
  for making sure the operation itself is safe to run concurrently
  (associative reducers, no unprotected shared mutable state).

## Key takeaway

Parallel collections and atomic references exist so you rarely need to
write `synchronized`/`wait`/`notify` by hand. `.par` gives you free
data-parallelism for map-reduce-shaped work, as long as your reducer is
associative and you avoid touching shared mutable state from inside the
parallel callback. `AtomicReference` gives you a lock-free way to safely
share and update a single value across threads, using the
get/set/compareAndSet/updateAndGet/accumulateAndGet family — pick the
narrowest tool that solves your actual problem instead of defaulting to raw
locks.

---

## Exercises

1. Rewrite the buggy `sum` example (`var sum = 0; List(1,2,3).par.foreach(sum
   += _)`) two different ways so it's race-free: once using
   `AtomicReference[Int]` (or `AtomicInteger`) with `getAndAccumulate`, and
   once by replacing `foreach` with `.par.sum` or `.par.reduce(_ + _)`
   entirely. Compare which is simpler and explain why.
2. Using `measure`, benchmark `.par` vs. serial for an operation that's
   actually expensive per element (e.g. checking primality of each number in
   `1 to 100000`) and one that's cheap (e.g. `_ + 1` over `1 to 100`). Confirm
   that `.par` only wins in the expensive case.
3. Build a thread-safe ID generator: an `AtomicReference[Long]` (or
   `AtomicLong`) starting at 0, with a `nextId()` method that atomically
   increments and returns a fresh value using `getAndUpdate` or
   `getAndAccumulate`. Spin up 10 threads that each call `nextId()` 1000
   times into a shared (thread-safe!) collection, and verify you got 10,000
   unique IDs with no duplicates.
