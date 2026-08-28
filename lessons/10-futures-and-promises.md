# Lesson 10 — Futures & Promises

Source: `src/lectures/part3concurrency/FuturesPromises.scala`

A `Future[T]` represents a computation that may not have a result *yet* —
something running on another thread that will eventually complete with a
value or an exception. If you know `Option` (Lesson 0), `Future` is its async
cousin: instead of "a value that might be missing right now," it's "a value
that isn't ready right now, but will be." Same `map`/`flatMap`/`filter`/
for-comprehension vocabulary applies — you'll see that reused almost verbatim
below.

## 1. Creating a `Future` — and the implicit `ExecutionContext` it needs

```scala
import scala.concurrent.ExecutionContext.Implicits.global

def calculateMeaningOfLife: Int = {
  Thread.sleep(2000)
  42
}

val aFuture = Future {
  calculateMeaningOfLife // calculates the meaning of life on ANOTHER thread
}
```
(lines 8, 14-21)

`Future { ... }` schedules the block to run asynchronously and immediately
returns a `Future[Int]` — a handle you can hold onto while the real work
happens elsewhere. But `Future.apply` needs to know *which thread pool* to run
your block on, and it takes that as an implicit `ExecutionContext` parameter.
That's why line 8's import isn't decorative:
`scala.concurrent.ExecutionContext.Implicits.global` brings a default
thread-pool-backed `ExecutionContext` into implicit scope, and the compiler
silently threads it through every `Future`/`onComplete`/`map` call in the
file. No import, no compile.

Gotcha: forgetting this import is the single most common "why won't my
`Future` code compile" moment — the error is a missing implicit parameter,
which can look cryptic if you don't know to look for an `ExecutionContext`.

## 2. Checking status without blocking: `.value`

```scala
println(aFuture.value) // Option[Try[Int]]
```
(line 24)

`.value` gives you a peek right now: `None` if it hasn't finished, or
`Some(Success(result))` / `Some(Failure(exception))` once it has. Notice the
shape — `Option[Try[Int]]` — `Option` for "has it completed yet" wrapping
`Try` for "did it succeed." This never blocks; it just reports what's known at
the instant you call it, which is why running this line immediately after
creating a 2-second future prints `None`.

## 3. `onComplete` — registering a callback

```scala
aFuture.onComplete {
  case Success(meaningOfLife) => println(s"the meaning of life is $meaningOfLife")
  case Failure(e) => println(s"I have failed with $e")
} // SOME thread
```
(lines 27-30)

`onComplete` takes a `Try[T] => Unit` callback and runs it whenever the
future finishes — success or failure, matched with the `Success`/`Failure`
pattern from `scala.util.Try`. Crucially, the callback doesn't run on *your*
thread; it runs on **some** thread from the `ExecutionContext`'s pool,
whichever happens to be free. That's why the comment says "SOME thread" — you
have no guarantee it's the thread that called `onComplete`, and no guarantee
*when* it fires relative to the rest of your program's execution. The
`Thread.sleep(3000)` right after (line 32) exists purely so the `main` thread
doesn't exit before the callback has a chance to run — in real code you'd
never block like this; it's only here so the demo prints before the JVM
shuts down.

Gotcha: callback ordering across *different* futures is non-deterministic.
If you register callbacks on two independent futures, you cannot predict
which fires first — only that each one fires after *its own* future
completes.

## 4. Composing futures: `map`, `flatMap`, `filter`, for-comprehensions

This is the same monadic API from `Option` (Lesson 0), applied to something
that resolves later instead of something that might be absent:

```scala
val mark = SocialNetwork.fetchProfile("fb.id.1-zuck")

val nameOnTheWall = mark.map(profile => profile.name)
val marksBestFriend = mark.flatMap(profile => SocialNetwork.fetchBestFriend(profile))
val zucksBestFriendRestricted = marksBestFriend.filter(profile => profile.name.startsWith("Z"))
```
(lines 69, 84-86)

- `.map` transforms the eventual value without blocking to get it — you get
  back a new `Future` that will hold the transformed result once the
  original completes.
- `.flatMap` is for when the transformation *itself* returns a `Future`
  (`fetchBestFriend` returns `Future[Profile]`) — exactly the "chain two
  async steps" pattern that `flatMap` also solves for `Option`'s "chain two
  possibly-missing steps."
- `.filter` keeps the future's value only if a predicate holds; if it
  doesn't, the resulting future fails with a `NoSuchElementException`
  instead of producing a value — the async equivalent of `Option.filter`
  collapsing to `None`.

And because `map`/`flatMap`/`withFilter` are all that's needed, for-
comprehensions work on `Future` exactly like they do on `Option`/`List`:

```scala
for {
  mark <- SocialNetwork.fetchProfile("fb.id.1-zuck")
  bill <- SocialNetwork.fetchBestFriend(mark)
} mark.poke(bill)
```
(lines 89-92)

This fetches Mark, then (once that completes) fetches his best friend, then
runs `poke` — all without a single explicit callback or blocking call. The
banking example does the same thing but `yield`s a value instead of running
a side effect:

```scala
val transactionStatusFuture = for {
  user <- fetchUser(username)
  transaction <- createTransaction(user, merchantName, cost)
} yield transaction.status
```
(lines 130-133)

## 5. Blocking when you must: `Await.result`

```scala
Await.result(transactionStatusFuture, 2.seconds) // implicit conversions -> pimp my library
```
(line 135)

Sometimes you genuinely need a synchronous value back — e.g. a method
signature (`purchase`, line 126) that promises to return a `String`, not a
`Future[String]`. `Await.result(future, duration)` blocks the calling thread
until the future completes (or throws a `TimeoutException` if it takes
longer than `duration`). The `2.seconds` literal only works because of an
implicit conversion pulled in by `scala.concurrent.duration._` (line 5) — a
"pimp my library" pattern (see Lesson 1's dark sugars) that lets `Int` values
grow a `.seconds` method. Treat `Await` as an escape hatch for the edges of
your program (tests, `main` methods), not something to sprinkle through
async code — it defeats the entire point of using futures.

## 6. Error handling: `recover`, `recoverWith`, `fallbackTo`

```scala
val aProfileNoMatterWhat = SocialNetwork.fetchProfile("unknown id").recover {
  case e: Throwable => Profile("fb.id.0-dummy", "Forever alone")
}

val aFetchedProfileNoMatterWhat = SocialNetwork.fetchProfile("unknown id").recoverWith {
  case e: Throwable => SocialNetwork.fetchProfile("fb.id.0-dummy")
}

val fallbackResult = SocialNetwork.fetchProfile("unknown id")
  .fallbackTo(SocialNetwork.fetchProfile("fb.id.0-dummy"))
```
(lines 97-105)

`fetchProfile("unknown id")` fails (the map lookup in `SocialNetwork.names`
throws `NoSuchElementException`), so this trio shows three ways to turn a
failed future into a successful one:

- `.recover { case ... => plainValue }` — supply a plain fallback *value* for
  matched exceptions. The async equivalent of `Try.recover` / `Option`'s
  `getOrElse`, but pattern-matched on the exception type.
- `.recoverWith { case ... => anotherFuture }` — same idea, but the fallback
  is itself a `Future` (another async operation), so it's `flatMap`-shaped
  rather than `map`-shaped.
- `.fallbackTo(otherFuture)` — simplest form: if this future fails, use the
  result of `otherFuture` instead (ignoring the specific exception).

## 7. `Promise` — the write side of a `Future`

A `Future` is read-only from the outside: you can `map`/`onComplete` it, but
you can't reach in and set its value. `Promise` is the companion type that
*can*:

```scala
val promise = Promise[Int]() // "controller" over a future
val future = promise.future

// thread 1 - "consumer"
future.onComplete {
  case Success(r) => println("[consumer] I've received " + r)
}

// thread 2 - "producer"
val producer = new Thread(() => {
  println("[producer] crunching numbers...")
  Thread.sleep(500)
  promise.success(42) // "fulfilling" the promise
  println("[producer] done")
})

producer.start()
```
(lines 143-160)

`Promise[Int]()` creates a container with an associated, not-yet-complete
`Future[Int]` (`promise.future`). One party (the "consumer") only ever sees
that `future` and reacts to it. A completely separate party (the "producer")
holds the `promise` itself and decides *when* and *with what* to complete it
by calling `promise.success(value)` (or `.failure(exception)`, or
`.complete(tryValue)`). The moment `success` is called, every callback
already registered on `promise.future` fires. This is the primitive
underneath `Future.apply` itself — and it's what you reach for whenever you
need to bridge a callback-based API (like a raw thread, a socket listener,
or a legacy callback library) into `Future`-land: wrap it in a `Promise`,
complete the promise from inside the callback, hand out `promise.future`.

```
                 promise.success(42)
                        │  (write side — producer only)
                        ▼
   Promise[Int]  ───.future───▶  Future[Int]
                                      │  (read side — map/flatMap/onComplete)
                                      ▼
                                 consumer(s)
```
`Future` alone has no "write" API — the whole reason `Promise` exists is to
be that missing other half, held by whoever is producing the result while
every consumer only ever touches the `Future`.

`tryComplete` (used below) is the "safe" variant: it attempts to complete the
promise and returns a `Boolean` saying whether it succeeded, instead of
throwing if the promise was already completed.

### Building future combinators out of promises

The rest of the file (lines 163-232) shows that useful `Future` combinators
that don't ship in the standard library can be built from `Promise` plus
`onComplete`:

```scala
// 3 - first out of two futures
def first[A](fa: Future[A], fb: Future[A]): Future[A] = {
  val promise = Promise[A]
  fa.onComplete(promise.tryComplete)
  fb.onComplete(promise.tryComplete)
  promise.future
}
```
(lines 178-184)

Both `fa` and `fb` race to complete the same `promise` — whichever finishes
first wins (the second `tryComplete` call is a harmless no-op since the
promise is already done). `last` (lines 187-200) is the mirror image: it uses
*two* promises, one that "absorbs" the first completion and a second
(`lastPromise`) that only gets completed when a result arrives after the
first one already landed.

`retryUntil` (lines 217-222) composes `filter` and `recoverWith` to keep
re-running an async `action` until its result satisfies a `condition`:

```scala
def retryUntil[A](action: () => Future[A], condition: A => Boolean): Future[A] =
  action()
    .filter(condition)
    .recoverWith {
      case _ => retryUntil(action, condition)
    }
```
`.filter` makes the future fail if the condition isn't met; `.recoverWith`
catches that failure and recurses, trying again. No loops, no blocking — just
the same handful of combinators you'd use on `Option`, chained recursively.

## Key takeaway

`Future[T]` is "a value that will exist later" the way `Option[T]` is "a
value that might not exist" — and it's transformed with the identical
`map`/`flatMap`/`filter`/for-comprehension vocabulary, so anything you
already know about composing `Option`s composes futures too. Reading a
future's result requires either a non-blocking callback (`onComplete`,
non-deterministic about which thread and when it runs) or a deliberate
blocking call (`Await.result`, an escape hatch, not a habit). `Promise` is
the other half of the picture: it's the "write side" that lets you manually
decide when a future completes, which is exactly the tool you need both to
bridge non-`Future` async APIs into `Future`-land and to build your own
future combinators (`first`, `last`, `retryUntil`) that the standard library
doesn't provide.

---

## Exercises

1. Write `def fulfillImmediately[T](value: T): Future[T]` two ways: (a) using
   `Future(value)` directly (as in line 172), and (b) using a `Promise` that
   you complete synchronously before returning `.future`. Confirm both give
   you an already-completed future (`.value` returns `Some(Success(value))`
   right away).
2. Using `recoverWith`, write `def fetchProfileOrDummy(id: String): Future[Profile]`
   that calls `SocialNetwork.fetchProfile(id)` and falls back to
   `SocialNetwork.fetchProfile("fb.id.0-dummy")` on any failure — then do the
   same thing with `fallbackTo` and confirm they behave identically for this
   case.
3. (Harder) Implement `def inSequence[A, B](first: Future[A], second: Future[B]): Future[B]`
   without looking at line 174-175, using `flatMap`. Then write a quick test
   with two futures that each `println` when they start, and confirm `second`
   only starts *after* `first` completes (rather than both starting
   immediately, which is what happens if you create them eagerly before
   calling `inSequence`).
