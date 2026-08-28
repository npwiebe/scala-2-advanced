# Lesson 6 — Monads

Source: `src/lectures/part2afp/Monads.scala`

You already know `Option`'s `map`/`flatMap`/`filter` from Lesson 0, and you've
used `List`'s the same way for years. This lesson pulls back the curtain:
`map`/`flatMap` aren't `Option`- or `List`-specific tricks — they're the
defining API of a general pattern called a **monad**. Once you know the
pattern, you can build your own "wrapper types" (like a lazy computation, or
a `Try`-alike) that plug into `for`-comprehensions exactly like `Option` and
`List` do.

## The running example: a hand-rolled `Try`

```scala
trait Attempt[+A] {
  def flatMap[B](f: A => Attempt[B]): Attempt[B]
}
object Attempt {
  def apply[A](a: => A): Attempt[A] =
    try { Success(a) } catch { case e: Throwable => Fail(e) }
}

case class Success[+A](value: A) extends Attempt[A] {
  def flatMap[B](f: A => Attempt[B]): Attempt[B] =
    try { f(value) } catch { case e: Throwable => Fail(e) }
}

case class Fail(e: Throwable) extends Attempt[Nothing] {
  def flatMap[B](f: Nothing => Attempt[B]): Attempt[B] = this
}
```
(lines 10–33). `Attempt` is a two-flavor container just like `Option`
(`Success`/`Fail` instead of `Some`/`None`), except it wraps a computation
that might *throw* rather than one that might be *absent*. `Attempt(a)` runs
`a` eagerly, by-name (`a: => A`), and catches any exception into `Fail`.
`Success.flatMap` also wraps the call to `f` in a `try`, so a failure that
happens *later* in the chain gets caught too — that's the whole value
proposition over a plain `try`/`catch`: composing several risky steps without
re-wrapping each one by hand.

```scala
val attempt = Attempt { throw new RuntimeException("My own monad, yes!") }
println(attempt) // Fail(java.lang.RuntimeException: My own monad, yes!)
```
(lines 62–66).

## What makes something "a monad": `unit` + `flatMap`, obeying three laws

A type constructor is a monad if it has:
- a way to **wrap** a plain value into the container — traditionally called
  `unit` in category-theory terms; in this codebase it's the `apply` method
  on the companion object (`Attempt.apply`, `Lazy.apply`; for `Option` it's
  `Some(_)`, for `List` it's `List(_)`).
- a **`flatMap`** that lets you chain computations that themselves produce
  a wrapped value, without ending up with nested wrappers.

That's not enough on its own, though — `unit` and `flatMap` have to satisfy
three algebraic laws, or the container will misbehave in ways that break
`for`-comprehensions and general reasoning about the type. The file proves
all three directly on `Attempt`, in the comment block at lines 35–60:

**1. Left identity** — wrapping a value and immediately `flatMap`ping is the
same as just calling the function on the value:
```
unit.flatMap(f) = f(x)
Attempt(x).flatMap(f) = f(x)      // Success case
Success(x).flatMap(f) = f(x)      // proved — flatMap on Success just calls f
```
In other words, `unit` doesn't add any hidden behavior — it's a transparent
wrapper.

**2. Right identity** — `flatMap`ping with `unit` itself is a no-op:
```
attempt.flatMap(unit) = attempt
Success(x).flatMap(x => Attempt(x)) = Attempt(x) = Success(x)
Fail(e).flatMap(...)  = Fail(e)
```
Re-wrapping the value you already have and handing it right back changes
nothing. (`Fail` also trivially satisfies this — line 32's `flatMap` always
returns `this`, ignoring `f` entirely, so short-circuiting is preserved no
matter what you pass it — the same "poison pill" behavior `None` has.)

**3. Associativity** — it doesn't matter whether you group chained
`flatMap`s left-to-right or flatten the second one into the first's callback;
you get the same result either way:
```
attempt.flatMap(f).flatMap(g) == attempt.flatMap(x => f(x).flatMap(g))
```
The comment walks both branches for `Fail` (both sides trivially equal
`Fail(e)`, since `Fail.flatMap` ignores its argument) and for `Success(v)`
(both sides reduce to `f(v).flatMap(g)`, or a `Fail` if either step throws).
This law is what guarantees that chaining `.flatMap` calls behaves like
"do this, then this, then this" regardless of how you parenthesize or
`for`-comprehend it — no surprise reordering or double-evaluation.

**Gotcha:** these are laws you must *prove by hand* (as the comments do) —
the Scala compiler does not check them. Nothing stops you from writing a
`flatMap` that compiles but violates associativity; it'll just behave
incoherently the moment someone chains it in a `for`-comprehension.

## Exercise 1 in the file: `Lazy[T]`, a monad for deferred computation

```scala
class Lazy[+A](value: => A) {
  private lazy val internalValue = value
  def use: A = internalValue
  def flatMap[B](f: (=> A) => Lazy[B]): Lazy[B] = f(internalValue)
}
object Lazy {
  def apply[A](value: => A): Lazy[A] = new Lazy(value) // unit
}
```
(lines 88–96). This is a second, independent monad built from scratch — it
wraps a by-name `value: => A` and only forces it (via Scala's `lazy val`,
"call by need") the first time `.use` is called. `Lazy.apply` is the `unit`;
`flatMap` threads the not-yet-evaluated value into `f` without forcing it
itself, so laziness is preserved through the whole chain.

```scala
val lazyInstance = Lazy {
  println("Today I don't feel like doing anything")
  42
}
val flatMappedInstance = lazyInstance.flatMap(x => Lazy { 10 * x })
```
(lines 98–105) — the `println` only fires when something eventually calls
`.use`, no matter how many times you `flatMap` on top of `lazyInstance`
first. The file states the exact same three laws for `Lazy` at lines
112–125, with the same shape of proof — this is the point: *any* type with
a lawful `unit`+`flatMap` pair gets these guarantees, not just `Attempt`.

## Exercise 2 in the file: `map` and `flatten` are derivable from `flatMap`

The comment at lines 74–140 makes the deeper claim explicit:

```
Monads = unit + flatMap
Monads = unit + map + flatten
```

These are two equivalent ways of defining the same structure, because once
you have `unit` and `flatMap`, `map` and `flatten` fall out for free:

```scala
def map[B](f: T => B): Monad[B] = flatMap(x => unit(f(x)))
def flatten(m: Monad[Monad[T]]): Monad[T] = m.flatMap((x: Monad[T]) => x)
```
(lines 133–134, with `flatten` also implemented concretely for `Lazy` at
line 127: `def flatten[T](lz: Lazy[Lazy[T]]): Lazy[T] = lz.flatMap(x => x)`).

`map(f)` is just "`flatMap`, but re-wrap the plain result with `unit`
instead of expecting `f` to return a wrapped value already." `flatten` is
just "`flatMap` with the identity function" — unwrap one layer of nesting by
handing the inner monad straight back. The file spells out both laws on the
type you already know:

```
List(1,2,3).map(_ * 2) = List(1,2,3).flatMap(x => List(x * 2))
List(List(1,2), List(3,4)).flatten
  = List(List(1,2), List(3,4)).flatMap(x => x)
  = List(1,2,3,4)
```
(lines 136–137). This is exactly why `Option` behaves the way it does in
Lesson 0: `Some(5).map(_ * 2)` is really `Some(5).flatMap(x => Some(x * 2))`
under the hood, and a `None` anywhere in a chain propagates because
`None.flatMap(f) = None`, the same "return `this`" short-circuit as
`Fail.flatMap` on line 32. `Option` and `List` were never special-cased
containers — they're just two more implementations of the same
`unit`/`flatMap` contract this file builds from scratch twice.

## Why this matters: `for`-comprehensions are monad sugar, not `List`/`Option` sugar

Lesson 0 showed `for { n <- name; if n.length > 2 } yield ...` working on
`Option`, and you've written the identical shape over `List`. That's not a
coincidence or two separate special cases the compiler knows about — a
`for`-comprehension desugars purely in terms of `map`/`flatMap`/`withFilter`,
mechanically, regardless of what type it's operating over. Concretely:

```scala
for { x <- lazyInstance } yield x * 10
// desugars to:
lazyInstance.map(_ * 10)
// which (per the law above) is:
lazyInstance.flatMap(x => Lazy(x * 10))
```

Since `Attempt` and `Lazy` in this file both define `flatMap` (and could
trivially get `map` for free via the law above), **either one could be
dropped into a `for`-comprehension right now** and it would compose exactly
like `Option`/`List` do — chain several `Attempt`-returning steps and the
first `Fail` short-circuits the rest, just like `None` does. This is the
payoff of the whole lesson: "supports `for`-comprehensions" isn't a
built-in language feature restricted to a handful of blessed types — it's
available to *any* type you write, as long as its `flatMap` obeys the three
laws proved above.

## Key takeaway

A monad is nothing more than a container with a lawful `unit` (construct a
wrapped value — `apply` on `Attempt`/`Lazy`, `Some`/`List(_)` elsewhere) and
a lawful `flatMap` (chain computations without accumulating nested
wrappers), where "lawful" means left identity, right identity, and
associativity all hold. `map` and `flatten` are never independently
required — they're derivable from `flatMap` and `unit`
(`map = flatMap` + re-wrap, `flatten = flatMap(identity)`). `Option` and
`List`, which you already use daily, are just two concrete monads; `Attempt`
and `Lazy` in this file are two more, built from nothing to prove the pattern
is general. Because `for`-comprehensions are pure `map`/`flatMap` sugar, any
type that plays by these rules gets `for`-comprehension support automatically
— that's the real reason `Option`, `List`, `Future`, and `Try` all feel like
they belong to "the same family" even though they solve unrelated problems.

---

## Exercises

1. Do the file's own Exercise 1 for real: add a `map[B](f: A => B): Attempt[B]`
   method to `Attempt` (don't peek at `Lazy`'s law first — derive it from
   `flatMap` and `Attempt.apply` the way line 133 shows), then confirm
   `Attempt(1 / 0).map(_ + 1)` still evaluates to a `Fail` without throwing.
2. Prove left identity, right identity, and associativity for `Option`
   yourself, on paper, the same way the comments at lines 35–60 do for
   `Attempt` — substitute `Some(x)`/`None` for `Success(x)`/`Fail(e)` and
   `Some(_)` for `unit`. Where does the proof for `None` line up with `Fail`?
3. Write a `for`-comprehension over two `Lazy` values, e.g.
   `for { a <- lazyInstance; b <- Lazy(2) } yield a + b`, then manually
   rewrite it as nested `flatMap`/`map` calls to confirm they produce
   identical `.use` results — and confirm the `println` side effects inside
   each `Lazy` still only fire once, on first `.use`, however many times you
   `flatMap` on top of them.
