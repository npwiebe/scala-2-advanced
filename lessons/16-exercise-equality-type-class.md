# Lesson 16 — Exercise: Equality Type Class

Source: `src/exercises/EqualityPlayground.scala`

This lesson assumes Lesson 15 (Type Classes): a trait with a type parameter
(`Trait[T]`), implicit instances per concrete type, and a companion `apply`
that summons the right instance for you. Here we apply that pattern to solve
a real problem: `==` in Scala compiles for *any* two types, even when
comparing them is nonsense. This exercise builds an `Equal[T]` type class
that only compiles when a matching instance actually exists — turning a
runtime footgun into a compile-time error.

## 1. The problem `==` doesn't solve

```scala
println(john == 43)
```
(line 57) This compiles and runs, silently printing `false`. `john` is a
`User`, `43` is an `Int` — there's no sensible way to compare them, but
Scala's `==` (inherited from `AnyRef`/`Any`) accepts *anything* on both sides.
Typos like comparing the wrong variable, or comparing a wrapped value to its
unwrapped counterpart, slip through code review and show up as silent bugs
in production instead of compiler errors.

## 2. The `Equal[T]` trait

```scala
trait Equal[T] {
  def apply(a: T, b: T): Boolean
}
```
(lines 13–15) This is the type class contract: "for type `T`, here is how to
decide if two values of that type are equal." Note both parameters are `T` —
that's the whole point. You can't even *write* an `Equal[T]` instance whose
`apply` mixes types, and (as we'll see below) you can't *invoke* comparison
across types either.

## 3. Implicit instances — the actual comparison logic

```scala
implicit object NameEquality extends Equal[User] {
  override def apply(a: User, b: User): Boolean = a.name == b.name
}

object FullEquality extends Equal[User] {
  override def apply(a: User, b: User): Boolean = a.name == b.name && a.email == b.email
}
```
(lines 17–23) `NameEquality` is marked `implicit` — it's the instance the
compiler will pick up automatically when something asks for an
`implicit equalizer: Equal[User]`. `FullEquality` is *not* implicit; it exists
to show you can define several strategies for the same type and choose one
explicitly (e.g. `Equal(john, anotherJohn)(FullEquality)`) when the default
isn't what you want.

Gotcha: only one *implicit* `Equal[User]` can be in scope at a call site
without ambiguity errors. If you uncommented a second `implicit object` for
`User`, any unqualified call to `Equal(a, b)` or `a === b` would fail to
compile with "ambiguous implicit values" — the compiler refuses to silently
guess which comparison you meant.

## 4. The type class companion: summoning the instance

```scala
object Equal {
  def apply[T](a: T, b: T)(implicit equalizer: Equal[T]): Boolean =
    equalizer.apply(a, b)
}

println(Equal(john, anotherJohn))
```
(lines 28–35) `Equal.apply[T]` takes two values *and* an implicit
`Equal[T]` for that same `T`. The compiler infers `T = User` from `john`/
`anotherJohn`, then searches implicit scope for an `Equal[User]` — finds
`NameEquality` — and passes it in automatically. This is **ad-hoc
polymorphism** (the comment on line 36 names it directly): `Equal(john,
anotherJohn)` behaves differently depending on *which type* `T` is, decided
by which implicit instance exists for it, without any inheritance hierarchy
or virtual dispatch.

Crucially: if you called `Equal(john, 43)`, type inference would fail to
unify `T` (a `User` and an `Int` can't both be `T`), and even if it somehow
picked a `T`, there is no `Equal[Int]` (or whatever) instance in scope — so
it wouldn't compile. Compare that to `john == 43` from section 1, which
compiles fine and just returns `false`.

## 5. Implicit class sugar: `===` and `!==`

```scala
implicit class TypeSafeEqual[T](value: T) {
  def ===(other: T)(implicit equalizer: Equal[T]): Boolean = equalizer.apply(value, other)
  def !==(other: T)(implicit equalizer: Equal[T]): Boolean = ! equalizer.apply(value, other)
}

println(john === anotherJohn)
```
(lines 43–48) `TypeSafeEqual[T]` wraps *any* value of type `T` and adds
`===`/`!==` methods to it, each requiring an implicit `Equal[T]`. Because
`===` is generic in `T` but both operands (`value` and `other`) are pinned to
the *same* `T`, writing `john === anotherJohn` only type-checks if both sides
are `User` (so `T` unifies to `User`) **and** an `implicit Equal[User]`
exists. The comment block on lines 50–53 traces the desugaring:

```
john.===(anotherJohn)
new TypeSafeEqual[User](john).===(anotherJohn)
new TypeSafeEqual[User](john).===(anotherJohn)(NameEquality)
```

This is the same "add methods to existing types" mechanism from Lesson 1's
dark sugars (implicit classes), now aimed specifically at compile-time-safe
comparison — the payoff of combining type classes with implicit conversions.

## 6. The type-safety payoff, side by side

```scala
println(john == 43)        // TYPE SAFE? No — compiles, runs, prints false
//  println(john === 43)   // TYPE SAFE — commented out because it WON'T COMPILE
```
(lines 57–58) This is the whole exercise distilled into two lines. `==`
happily compares a `User` to an `Int` and gives you a wrong-but-plausible
`false`. `===` refuses: `43` isn't a `User`, so `T` can't unify, so there's
no valid implicit `Equal[T]` to find, so the compiler rejects the line
outright. The bug moves from "silent wrong answer discovered in production"
to "red squiggly line in your editor."

## Key takeaway

`==` is universally callable but carries no type safety — any two types
"compile," even when comparing them is meaningless. Wrapping comparison
logic in a type class (`Equal[T]`) plus an implicit-class operator (`===`)
gives you comparison syntax that *looks* just as lightweight as `==`, but
only exists for types that have opted in with an instance, and only unifies
both sides to the same type. This is the general shape of "make illegal
states unrepresentable" via the type system: push a class of bug from
runtime to compile time by making the compiler do the checking implicits
already give you for free.

---

## Exercises

1. Define a second type — e.g. a small `Point(x: Int, y: Int)` case class —
   and write an `implicit object PointEquality extends Equal[Point]` that
   compares both coordinates. Confirm `Point(1,2) === Point(1,2)` compiles
   and returns `true`, and that `Point(1,2) === john` (a `User`) fails to
   compile.
2. `FullEquality` (line 21) is defined but never wired up as an implicit
   default and never used with `===`. Call it explicitly —
   `Equal(john, anotherJohn)(FullEquality)` — and separately, write a local
   scope (e.g. inside a small method) where you shadow `NameEquality` by
   bringing `FullEquality` into implicit scope, so `john === anotherJohn`
   evaluates using full-field comparison instead of name-only.
3. Add a `Ordered`-style extension: an `Equal[T]` subtype or sibling trait
   `Approx[T]` with `def apply(a: T, b: T, tolerance: Double): Boolean`, plus
   an implicit class exposing `~==` for `Double` (e.g.
   `3.0001 ~== (3.0, 0.01)`). This tests whether you can extend the pattern
   to a type class whose comparison takes an *extra* parameter beyond the
   two values being compared.
