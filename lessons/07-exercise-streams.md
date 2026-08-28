# Lesson 7 — Exercise: Streams

Source: `src/exercises/StreamsPlayground.scala`

This lesson is a worked exercise, not new syntax. The file builds `MyStream[+A]`
— a lazily-evaluated, potentially **infinite** linked structure — from scratch.
It leans directly on Lesson 5's call-by-need (`lazy val`) and Lesson 2's
`unapply`-free-but-still-extractor-shaped operators (`::`-style symbolic,
right-associative methods from Lesson 1 too). If infinite lists sound
impossible, that's the point this exercise proves wrong.

## 1. The contract: `MyStream[+A]` (lines 10–37)

```scala
abstract class MyStream[+A] {
  def isEmpty: Boolean
  def head: A
  def tail: MyStream[A]

  def #::[B >: A](element: B): MyStream[B]  // prepend operator
  def ++[B >: A](anotherStream: => MyStream[B]): MyStream[B]
  ...
}
```
This is deliberately shaped like `List`: `isEmpty`/`head`/`tail`, plus the
usual `map`/`flatMap`/`filter`/`foreach`. The `+A` variance and the `[B >: A]`
lower bounds on `#::`/`++` are the same defensive-variance trick you'd use for
any covariant container — they let you prepend/concatenate a *supertype*
element without the compiler complaining. Nothing here is new; what's new is
that `tail` is a `MyStream[A]`, not a `List[A]`, and — critically — the
*implementations* of `tail` never have to fully exist up front.

## 2. Why `tail` must be lazy — `Cons` (lines 55–59)

```scala
class Cons[+A](hd: A, tl: => MyStream[A]) extends MyStream[A] {
  def isEmpty: Boolean = false
  override val head: A = hd
  override lazy val tail: MyStream[A] = tl  // call by need
```
`tl` is a by-name parameter (`=> MyStream[A]`), not an evaluated one. If it
were `tl: MyStream[A]`, then constructing `new Cons(1, computeRestOfStream)`
would force `computeRestOfStream` *immediately*, which for an infinite stream
means evaluating forever before `Cons`'s constructor ever returns — instant
stack overflow / non-termination. By-name delays that evaluation to "whenever
someone calls `.tail`", and `lazy val tail` (Lesson 5's `lazy val`) caches the
result so you never re-run the (possibly expensive) tail computation twice.
Together, `=> MyStream[A]` + `lazy val` is exactly "call by need": compute
once, on demand, remember the answer.

Gotcha: `head` is a plain `val`, not lazy — it's *always* eagerly known
because it's the value passed in when the `Cons` node was built. Only the
*rest of the stream* is deferred. That asymmetry (eager head, lazy tail) is
the whole trick behind an infinite structure being usable at all.

## 3. `#::`, the prepend operator (lines 15, 44, 64, and 101)

```scala
def #::[B >: A](element: B): MyStream[B] = new Cons(element, this)
...
val startFrom0 = 0 #:: naturals   // naturals.#::(0)
```
`#::` ends in `:`, so by Lesson 1's right-associativity rule it's called on
its right-hand operand: `0 #:: naturals` desugars to `naturals.#::(0)`, which
wraps `naturals` in a new `Cons` with `0` as the new head. `naturals` itself
is passed as the (still-lazy) `tail` — no elements of the existing stream get
touched, so this is an O(1) prepend regardless of how "long" (or infinite)
`naturals` is.

## 4. Generating the infinite stream — `MyStream.from` (lines 89–92)

```scala
object MyStream {
  def from[A](start: A)(generator: A => A): MyStream[A] =
    new Cons(start, MyStream.from(generator(start))(generator))
}
```
Read this as if it were strict and it looks like unbounded recursion:
`from` calls itself before returning. But because `Cons`'s second constructor
argument is by-name, `MyStream.from(generator(start))(generator)` is *not
evaluated* when passed in — it's wrapped up as a thunk and only runs the next
time something asks for `.tail`. That's how `MyStream.from(1)(_ + 1)`
(line 96) produces the infinite stream of naturals without ever looping.

## 5. Preserving laziness through `map`/`filter`/`flatMap` (lines 77–81)

```scala
def map[B](f: A => B): MyStream[B] = new Cons(f(head), tail.map(f))
def flatMap[B](f: A => MyStream[B]): MyStream[B] = f(head) ++ tail.flatMap(f)
def filter(predicate: A => Boolean): MyStream[A] =
  if (predicate(head)) new Cons(head, tail.filter(predicate))
  else tail.filter(predicate)
```
Notice every one of these builds a **new `Cons`** whose tail is
`tail.map(f)` / `tail.filter(predicate)` / etc. — another by-name argument,
so the recursive call is deferred exactly the same way `from` deferred its
recursive call. If `map` instead eagerly walked the whole stream to build a
`List`, it would never terminate on an infinite stream. This is the general
rule for any transformation on `MyStream`: as long as every recursive step is
wrapped inside a `new Cons(..., <lazy tail expression>)`, the infinite
structure stays infinite and lazy all the way through the pipeline.

Gotcha: `filter`'s `else tail.filter(predicate)` branch is *not* wrapped in a
`Cons` — it's a direct (non-lazy-argument-protected) recursive call. That's
fine as long as the predicate eventually matches something within a finite
number of tail-steps (true for e.g. "numbers not divisible by 2"), but a
predicate that never matches anything in an infinite stream would cause this
one specific call to recurse forever, unlike `map`.

## 6. Bounding the infinite: `take` and `toList` (lines 23–36, 83–86)

```scala
def take(n: Int): MyStream[A] =
  if (n <= 0) EmptyStream
  else if (n == 1) new Cons(head, EmptyStream)
  else new Cons(head, tail.take(n-1))

@tailrec
final def toList[B >: A](acc: List[B] = Nil): List[B] =
  if (isEmpty) acc.reverse
  else tail.toList(head :: acc)
```
`take(n)` is the one place the recursion is bounded by a decreasing counter
instead of relying purely on laziness — it explicitly caps the tail at
`EmptyStream` once `n` elements have been claimed, converting an infinite (or
merely large) stream into a genuinely finite one. Only *after* that
truncation is it safe to call the tail-recursive, strict `toList`, which
walks the now-finite structure into a real `List`. Calling `toList()` on an
un-`take`n infinite stream would never return — `toList` has no termination
condition of its own beyond `isEmpty`, which an infinite `Cons` chain never
reaches.

## 7. Worked uses: Fibonacci and the Sieve of Eratosthenes (lines 128–154)

```scala
def fibonacci(first: BigInt, second: BigInt): MyStream[BigInt] =
  new Cons(first, fibonacci(second, first + second))

def eratosthenes(numbers: MyStream[Int]): MyStream[Int] =
  if (numbers.isEmpty) numbers
  else new Cons(numbers.head, eratosthenes(numbers.tail.filter(_ % numbers.head != 0)))
```
Both follow the same shape as `MyStream.from`: an eager "here's the next
value" paired with a lazily-deferred recursive call for everything after it.
`fibonacci` needs no base case at all — it's infinite by construction.
`eratosthenes` is the more interesting one: at each step it keeps the current
head as a confirmed prime, then lazily filters *the rest* of the stream to
drop multiples of that prime — building the classic sieve one lazy `filter`
at a time, never materializing more of the number line than callers actually
consume via `take`.

## Key takeaway

An infinite data structure is possible in a strict language the moment you
make the "rest of it" a by-name parameter instead of a value — `tl: =>
MyStream[A]` plus `lazy val tail = tl` gives you compute-once-on-demand
semantics (Lesson 5's call-by-need, applied to a whole data structure instead
of a single value). Every combinator (`map`, `filter`, `flatMap`, `++`,
`from`) has to preserve that property by wrapping its recursive step inside a
new lazy `Cons`, or the "infinite" part breaks. `take` is the escape hatch:
it's the one operation that converts "infinite and lazy" into "finite," after
which strict operations like `toList` are safe to run.

---

## Exercises

1. Implement `takeWhile(predicate: A => Boolean): MyStream[A]` on `MyStream`
   (and both subclasses), analogous to `List.takeWhile`. It should stop
   producing elements as soon as `predicate` fails — verify it terminates on
   `naturals.takeWhile(_ < 100).toList()` even though `naturals` is infinite.
2. Implement `zipWith[B, C](otherStream: MyStream[B])(f: (A, B) => C):
   MyStream[C]`, combining two (possibly infinite) streams element-by-element
   with `f`, stopping when either stream is empty. Try it on two different
   `MyStream.from` streams and confirm laziness is preserved (i.e. it works
   even if both inputs are infinite, as long as you `take` the result).
3. (Harder) Add a `def find(predicate: A => Boolean): Option[A]` that scans
   the stream lazily and returns the first matching element without forcing
   the whole (possibly infinite) stream — use it to find the first Fibonacci
   number in `fibonacci(1, 1)` greater than `1000000`.
