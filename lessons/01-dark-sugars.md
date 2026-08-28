# Lesson 1 — Dark Syntax Sugars

Source: `src/lectures/part1as/DarkSugars.scala`

These are shorthand rewrites the Scala compiler performs. None of them are "new
power" — they're just conveniences you'll see constantly in real code (and in
libraries like Akka), so you need to recognize what they expand to.

## 1. Single-argument method with a block

```scala
def singleArgMethod(arg: Int): String = s"$arg little ducks..."
val description = singleArgMethod { 42 }
```
If a method takes exactly one argument, you may call it with `{ ... }` instead of
`(...)`. The block's last expression is the argument. This is why `Try { ... }`
and `List(1,2,3).map { x => x + 1 }` read like control structures even though
they're just method calls.

## 2. Single Abstract Method (SAM) → lambda
[Recap.scala](../src/lectures/part1as/Recap.scala)
```scala
trait Action { def act(x: Int): Int }
val aFunkyInstance: Action = (x: Int) => x + 1
```
If a trait/abstract class has exactly **one** unimplemented method, Scala lets
you instantiate it with a lambda instead of `new Action { override def act... }`.
This is how `new Thread(() => println("hi"))` works — `Runnable` has one method,
`run()`.

Gotcha: it also works when the abstract class has other **implemented**
methods, as long as only one is abstract (see `AnAbstractType` in the file).

## 3. `::` and other symbolic/colon-ending methods — right-associative

```scala
val prependedList = 2 :: List(3, 4)
```
`::` looks like a magic operator but it's just a method call. The rule: **any
method whose name ends in `:`** is right-associative, meaning
`2 :: List(3,4)` actually means `List(3,4).::(2)` — called on the right-hand
operand, not the left. This is the only exception to Scala's normal left-to-right
infix rule, and it exists specifically so `::` reads naturally for
cons-list construction: `1 :: 2 :: 3 :: List(4,5)`.

## 4. Multi-word method names

```scala
class TeenGirl(name: String) {
  def `and then said`(gossip: String) = println(s"$name said $gossip")
}
lilly `and then said` "Scala is so sweet!"
```
Backticks let a method name contain spaces/keywords. Rare in production code,
but you'll see it in test DSLs (ScalaTest's `"it should work" in { ... }`).

## 5. Infix types

```scala
class Composite[A, B]
val composite: Int Composite String = ???
```
For a two-type-parameter generic type `Composite[A, B]`, you can write
`A Composite B` instead of `Composite[A, B]`. Purely cosmetic, but explains
syntax you'll see in library type signatures (e.g. shapeless `A :: B`).

## 6. `apply` and `update`

```scala
val anArray = Array(1,2,3)
anArray(2) = 7   // rewritten to anArray.update(2, 7)
```
You already know `f(x)` calls `f.apply(x)`. The mirror-image rule: `f(x) = y`
rewrites to `f.update(x, y)`. This is exactly what makes array/map mutation
`arr(i) = v` look like assignment.

## 7. Setters for mutable containers (`_=` methods)

```scala
class Mutable {
  private var internalMember: Int = 0
  def member = internalMember
  def member_=(value: Int): Unit = internalMember = value
}
val m = new Mutable
m.member = 42   // rewritten to m.member_=(42)
```
Defining a method named `x_=` lets `instance.x = value` work like a real
assignment, even though `x` isn't a public var. This is the standard
encapsulation pattern: expose a "getter" (`member`) and "setter" (`member_=`)
method pair while keeping the backing field private.

---

## Exercises

Try these in `src/playground/ScalaPlayground.scala` (or a scratch file):

1. Write a trait `Adder { def add(x: Int, y: Int): Int }` and instantiate it
   using the SAM lambda shorthand.
2. Define your own right-associative cons operator `+:>` on a small wrapper
   class, and chain three calls of it like `1 +:> 2 +:> 3 +:> MyEmpty`.
   Print out what method-call form it desugars to.
3. Build a `Temperature` class with a private `celsius: Double` var, and
   `def celsius: Double` / `def celsius_=(c: Double): Unit` accessor methods.
   Confirm `val t = new Temperature(20); t.celsius = 25` works.
