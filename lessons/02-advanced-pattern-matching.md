# Lesson 2 — Advanced Pattern Matching

Source: `src/lectures/part1as/AdvancedPatternMatching.scala`

In the basics course, pattern matching worked "for free" on case classes,
tuples, constants, and wildcards. This lesson reveals *why* it works: match
patterns are just method calls to something called `unapply`. Once you know
the mechanism, you can make **any** type — not just case classes — pattern-
matchable.

## The mechanism: `unapply`

```scala
class Person(val name: String, val age: Int)

object Person {
  def unapply(person: Person): Option[(String, Int)] =
    if (person.age < 21) None
    else Some((person.name, person.age))
}

bob match { case Person(n, a) => s"Hi, my name is $n and I am $a yo." }
```
`case Person(n, a) => ...` desugars to calling `Person.unapply(bob)`. If it
returns `Some((name, age))`, the pattern matches and `n`/`a` get bound. If it
returns `None`, the case doesn't match — that's why case classes let you
pattern-match on them automatically: the compiler auto-generates an `unapply`
for every case class.

Notice `unapply` here also encodes matching *logic*, not just decomposition —
it returns `None` for anyone under 21, so `case Person(n, a)` will simply skip
underage people. Pattern matching can fail on purpose.

## Overloading `unapply`

```scala
object Person {
  def unapply(person: Person): Option[(String, Int)] = ...
  def unapply(age: Int): Option[String] = Some(if (age < 21) "minor" else "major")
}

bob.age match { case Person(status) => s"My legal status is $status" }
```
The same companion object can have multiple `unapply` overloads for different
input types. The compiler picks the one matching what you're deconstructing.

## Boolean patterns

```scala
object even { def unapply(arg: Int): Boolean = arg % 2 == 0 }

n match {
  case singleDigit() => "single digit"
  case even()        => "an even number"
  case _             => "no property"
}
```
`unapply` doesn't have to return `Option[T]`. If it returns plain `Boolean`,
the pattern becomes a property test with **no bindings** — `case even()` just
asks "does this satisfy `even.unapply`?".

## Infix patterns

```scala
case class Or[A, B](a: A, b: B)
val either = Or(2, "two")
either match { case number Or string => s"$number is written as $string" }
```
Any case class/extractor with exactly 2 extracted values can be matched
infix: `case number Or string` instead of `case Or(number, string)`. Purely
readability sugar (same right-associativity family as `::` from Lesson 1 —
except this is for *matching*, not construction).

## Decomposing sequences: `unapplySeq`

```scala
val vararg = numbers match { case List(1, _*) => "starting with 1" }
```
`List(1, _*)` works because `List`'s companion defines `unapplySeq`, returning
`Option[Seq[A]]` instead of a fixed tuple — letting you match a variable-length
head/tail pattern. You can define this yourself for custom recursive
structures:

```scala
object MyList {
  def unapplySeq[A](list: MyList[A]): Option[Seq[A]] =
    if (list == Empty) Some(Seq.empty)
    else unapplySeq(list.tail).map(list.head +: _)
}
myList match { case MyList(1, 2, _*) => "starting with 1, 2" }
```

## Custom return types for `unapply` (structural, not just `Option`)

```scala
abstract class Wrapper[T] { def isEmpty: Boolean; def get: T }

object PersonWrapper {
  def unapply(person: Person): Wrapper[String] = new Wrapper[String] {
    def isEmpty = false
    def get = person.name
  }
}
```
The compiler doesn't actually require `unapply` to return `Option[T]` — it
just needs the returned object to have `isEmpty: Boolean` and `get: T`
methods (structurally — this is why `Option` itself works: it has both).
This is niche but explains why `Option`-returning extractors aren't a hard
rule, just the common case.

## Key takeaway

Pattern matching = calling `unapply`/`unapplySeq` on an object and checking
what comes back. Case classes get one generated for free; you can write your
own on any `object` to make *any* type matchable, add validation logic to
matches, or expose boolean/property-style patterns.

---

## Exercises

1. Write an extractor object `positive` with `unapply(x: Int): Boolean` that
   matches positive integers, and a `negative` counterpart. Use both in a
   match expression that also has a `case _ => "zero"` fallback.
2. Write a class `Fraction(numerator: Int, denominator: Int)` with a companion
   `unapply` that returns `Option[(Int, Int)]` — but returns `None` if the
   denominator is 0 (poison-pill pattern like the `Person` age check).
3. (Harder) Write your own two-element extractor usable infix, e.g.
   `case a Pair b`, for a class `Pair[A, B](first: A, second: B)`.
