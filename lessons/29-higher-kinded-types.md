# Lesson 29 — Higher-Kinded Types

Source: `src/lectures/part5ts/HigherKindedTypes.scala`

You've now seen `Option`, `List`, and `Future` all support `map`/`flatMap`
(Lesson 0, Lesson 6), and you've seen type classes let you write one function
that works for any type with the right *capability*, decided at compile time
(Lesson 15, Lesson 17's `MyTypeClassTemplate`). This lesson fuses the two: how
do you write a type class whose capability is "can `flatMap`", when the thing
being described isn't a concrete type like `Int` or `String`, but a
*container* like `List` or `Option` — a type that itself needs a type
argument before it becomes concrete? The answer is a **higher-kinded type**.

## The problem: three identical methods, one per container

```scala
trait MyList[T] {
  def flatMap[B](f: T => B): MyList[B]
}

trait MyOption[T] {
  def flatMap[B](f: T => B): MyOption[B]
}

trait MyFuture[T] {
  def flatMap[B](f: T => B): MyFuture[B]
}
```
(lines 13–23). Three traits, structurally identical except for the container
name repeated three times (`MyList`, `MyOption`, `MyFuture`). Nothing in
ordinary generics lets you factor out "some container `C` with a `flatMap`,"
because `C` isn't a value's type — it's a *type constructor*: `MyList[T]` is
only a real type once you supply `T`. Ordinary type parameters like
`[T, B]` range over concrete types (`Int`, `String`, `MyList[Int]`); they
can't range over "the `MyList` part, still waiting for its argument."

The commented-out code makes the pain concrete:

```scala
//  def multiply[A, B](listA: List[A], listB: List[B]): List[(A, B)] =
//    for { a <- listA; b <- listB } yield (a, b)
//
//  def multiply[A, B](listA: Option[A], listB: Option[B]): Option[(A, B)] =
//    for { a <- listA; b <- listB } yield (a, b)
//
//  def multiply[A, B](listA: Future[A], listB: Future[B]): Future[(A, B)] =
//    for { a <- listA; b <- listB } yield (a, b)
```
(lines 27–43). Same body, three times, once per container. The only thing
that differs across the three overloads is which type sits in the `F[_]`
slot — `List`, `Option`, `Future`. To write this once, you need a way to
parameterize *over the container itself*, not just over what's inside it.

## `F[_]`: a type that takes a type

```scala
trait AHigherKindedType[F[_]]
```
(line 11). This is the whole trick, in one line. `F[_]` is a type parameter
that is itself generic — it declares "`F` is not a concrete type; `F` is a
*type constructor* that needs one type argument before it becomes concrete."
The underscore is a placeholder for that not-yet-supplied argument, exactly
the way `_` means "an unnamed slot" elsewhere in Scala.

The analogy that makes this click: you already know a **higher-order
function** is a function that takes another function as an argument, e.g.
`List[Int]#map(f: Int => Int)`. A **higher-kinded type** is the same move one
level up the type system: instead of a function parameterized by a function,
it's a *type* parameterized by a *type constructor*. `List` itself has kind
`* -> *` (informally: "give me one type, I'll give you back a concrete
type") — it is not concrete until applied, the same way `map` is not a
value until applied to a function. `AHigherKindedType[F[_]]` accepts that
still-waiting-for-an-argument thing directly, the way a higher-order function
accepts a still-waiting-to-be-called function.

Concretely, `List`, `Option`, and `Future` all fit the `F[_]` slot — you can
write `AHigherKindedType[List]`, `AHigherKindedType[Option]`,
`AHigherKindedType[Future]` — but `Int` or `String` cannot, because they're
already fully applied concrete types with no argument slot left to fill.

## Wiring it into a type class: `Monad[F[_], A]`

```scala
trait Monad[F[_], A] { // higher-kinded type class
  def flatMap[B](f: A => F[B]): F[B]
  def map[B](f: A => B): F[B]
}
```
(lines 47–50). This is a type class (Lesson 15's pattern) whose "capability
tag" is generalized in kind, not just in type: instead of describing "type
`T` has an `Ordering`" (a concrete-type type class), it describes "container
`F[_]`, holding an `A`, supports `flatMap` and `map`." `F` stays abstract —
this trait says nothing about *which* container, only that whichever one it
is, `flatMap`/`map` exist and return `F[B]`, the same container with the
element type swapped from `A` to `B`.

```scala
implicit class MonadList[A](list: List[A]) extends Monad[List, A] {
  override def flatMap[B](f: A => List[B]): List[B] = list.flatMap(f)
  override def map[B](f: A => B): List[B] = list.map(f)
}

implicit class MonadOption[A](option: Option[A]) extends Monad[Option, A] {
  override def flatMap[B](f: A => Option[B]): Option[B] = option.flatMap(f)
  override def map[B](f: A => B): Option[B] = option.map(f)
}
```
(lines 52–60). These are the type class *instances* — same shape as
Lesson 17's template (`implicit class`/`implicit object` wrapping an
existing method call). `MonadList` slots `List` into `F`; `MonadOption` slots
`Option` in. Each instance just forwards to the container's own real
`flatMap`/`map` — no new logic, just a uniform interface stapled on top of
two unrelated standard-library types. Because they're `implicit class`es,
plain `List(1,2,3)` and `Some(2)` get these methods "for free" via implicit
conversion, exactly like Lesson 14's pimp-my-library pattern.

## The payoff: one generic `multiply`, works for every `F[_]`

```scala
def multiply[F[_], A, B](ma: Monad[F, A], mb: Monad[F, B]): F[(A, B)] =
  for {
    a <- ma
    b <- mb
  } yield (a, b)
/*
  ma.flatMap(a => mb.map(b => (a,b)))
 */
```
(lines 62–69). This is the payoff for the whole lesson — one method,
polymorphic in both the element types (`A`, `B`, ordinary generics) *and* the
container (`F[_]`, the higher-kinded type parameter). The `for`-comprehension
desugars exactly the way Lesson 6 explained — to
`ma.flatMap(a => mb.map(b => (a, b)))` — but now that desugaring is generic
over any `F` for which a `Monad[F, _]` instance exists, instead of being
hardcoded to `List` or `Option` specifically.

```scala
println(multiply(List(1,2), List("a", "b")))
println(multiply(Some(2), Some("scala")))
```
(lines 79–80). The call sites just pass a `List` and an `Option` straight in
— the compiler implicitly wraps them into `MonadList`/`MonadOption` (because
those are `implicit class`es) to satisfy the `Monad[F, A]` parameter, infers
`F = List` in the first call and `F = Option` in the second, and runs the
*same* `multiply` body either way. No overload per container, no
copy-pasted `for`-comprehension — the three commented-out methods from
before have collapsed into one.

**Gotcha:** the file only writes `MonadList`/`MonadOption`, but `multiply`
compiles for *any* `F[_]` — the moment you write a `MonadFuture[A]` instance
analogous to lines 52–60 (wrapping `Future`'s real `flatMap`/`map`),
`multiply(someFuture, otherFuture)` works too, with no change to `multiply`
itself. The generality lives entirely in the `F[_]` type parameter and the
type class trait; adding a new container means adding one small instance, not
touching the generic algorithm.

## Connecting back to Lesson 6: this *is* "monad," made literal

Lesson 6 defined a monad informally as "any type with a lawful `unit` +
`flatMap`" and showed that `Option`, `List`, `Attempt`, and `Lazy` all
qualify despite having nothing to do with each other — the pattern was
asserted by writing the same-shaped code three or four separate times, once
per type, with no shared supertype tying them together in the type system.

`Monad[F[_], A]` is that same informal claim, but *encoded as an actual
type*: the trait's name is even `Monad`, and it packages exactly the two
operations Lesson 6 called the defining API — `flatMap` and `map` (`map`,
recall, is `flatMap` plus re-wrapping, so `Monad` here bundles both directly
rather than deriving `map` from `flatMap` the way Lesson 6's proof did).
Where Lesson 6 could only say "here are four unrelated types that each
happen to satisfy this pattern," higher-kinded types let you say it once, as
a single generic trait parameterized by `F[_]`, and then have the compiler
check every instance (`MonadList`, `MonadOption`, ...) against that one
contract. `multiply` is the concrete demonstration: a function that is
*provably* monad-generic, because its signature is `Monad[F, A] => ...`
rather than `List[A] => ...`, checked by the type system instead of by eye.

This is also why real functional libraries (Cats, Scalaz) define `Monad`,
`Functor`, and `Applicative` as literal `trait _[F[_]]` type classes — the
pattern in this file, not something more exotic, is the production version
of "make `map`/`flatMap`-generic code real."

## Key takeaway

An ordinary generic (`List[T]`) abstracts over a *value's type*. A
higher-kinded type (`F[_]`) abstracts over a *type constructor* — a type
that is itself waiting for a type argument, the same relationship a
higher-order function has to the functions it takes as arguments. That extra
level of abstraction is exactly what's needed to write one type class
(`Monad[F[_], A]`) describing "supports `flatMap`/`map`" without naming
`List`, `Option`, or `Future` anywhere in its definition, and one generic
function (`multiply[F[_], A, B]`) that works across all of them by requiring
only a `Monad[F, _]` instance, resolved implicitly per call site. It's
Lesson 6's monad pattern — previously just an informal shared shape across
unrelated types — made into a real, compiler-checked type-system construct.

---

## Exercises

1. Write a `MonadFuture[A]` instance (mirroring `MonadList`/`MonadOption` at
   lines 52–60) that extends `Monad[Future, A]` by forwarding to `Future`'s
   real `flatMap`/`map`. Then call `multiply(Future(1), Future("a"))` and
   confirm it compiles and runs with no changes to `multiply` itself.
2. `AHigherKindedType[F[_]]` (line 11) is otherwise unused in the file. Try
   writing `AHigherKindedType[List]` and `AHigherKindedType[Int]` — one
   compiles, one doesn't. Explain in your own words, in terms of "kind" (does
   the type still need an argument, or is it already concrete?), why.
3. Add a `Monad[F[_], A]`-generic function `combine3[F[_], A, B, C](ma:
   Monad[F, A], mb: Monad[F, B], mc: Monad[F, C]): F[(A, B, C)]` using a
   3-variable `for`-comprehension, and check it against both `List` and
   `Option` inputs — no new overloads needed, same pattern as `multiply`.
