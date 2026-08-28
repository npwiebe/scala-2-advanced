# Lesson 0 — Background: `Option`

Not covered by this course (it assumes you already know it), but you'll see
it used constantly starting in Lesson 2 (`unapply` returns `Option[...]`), so
it's worth pinning down before going further.

## The problem it solves

In Java you'd represent "a value that might be missing" with `null`, and get
`NullPointerException` when you forget to check. Scala instead makes
"might be missing" part of the **type**, so the compiler forces you to handle
the missing case.

## The type

```scala
sealed abstract class Option[+A]
case object None extends Option[Nothing]
case class Some[+A](value: A) extends Option[A]
```

That's it — `Option[A]` is just a 2-member enum: either `Some(value)` or
`None`. (This should look familiar: it's a case class + case object, exactly
like the `MyList`/`Cons`/`Empty` pattern from Lesson 2.)

```scala
val a: Option[Int] = Some(5)
val b: Option[Int] = None

val found: Option[String] = Map("Daniel" -> "555").get("Daniel") // Some("555")
val missing: Option[String] = Map("Daniel" -> "555").get("Jess") // None
```

## Getting the value out

```scala
found.get              // "555" — throws if it's actually None, avoid this
found.getOrElse("N/A") // "555", or "N/A" if None — the safe default
found.isEmpty          // false
found.isDefined        // true
```

## The important part: it's a monad-ish container (map/flatMap/filter)

This is *why* `Option` matters, and why it reappears when you hit Lesson 6
(Monads) and Lesson 15 (Type Classes) — `Option` is the simplest example of a
container you transform without ever manually unwrapping it:

```scala
val name: Option[String] = Some("Daniel")

name.map(_.toUpperCase)        // Some("DANIEL")
name.filter(_.length > 10)     // None (fails the predicate)
name.flatMap(n => Some(n + "!")) // Some("Daniel!")

// for-comprehensions work on Option too, exactly like on List:
val greeting = for {
  n <- name
  if n.length > 2
} yield s"Hi, $n"
// Some("Hi, Daniel")
```
If any step in a chain is `None`, everything downstream short-circuits to
`None` — no null checks, no exceptions, just composition.

## Pattern matching on it

```scala
found match {
  case Some(value) => s"got $value"
  case None        => "nothing here"
}
```
This works via the exact `unapply` mechanism from Lesson 2 — `Option` isn't
special-cased by the match compiler; it just plays by the same rules as
`Person` or `MyList`.

## Where you already saw it without noticing

- `Recap.scala` line 101: `val anOption = Some(2)` — just a passing mention.
- `AdvancedPatternMatching.scala`: every `unapply` in that lesson returns
  `Option[...]` — that lesson *is* "how do I write something like `Option`
  myself."

---

## Exercises

1. Write `def firstPositive(nums: List[Int]): Option[Int]` that returns the
   first positive number, or `None` if there isn't one, using `.find` (which
   already returns `Option`) — no manual loops.
2. Chain `.map`/`.filter`/`.getOrElse` on an `Option[Int]` to implement
   "if the value is present and even, double it; otherwise return -1" in one
   expression, no pattern match.
3. Predict, then verify: what does `Some(5).flatMap(x => None).getOrElse(0)`
   evaluate to, and why?
