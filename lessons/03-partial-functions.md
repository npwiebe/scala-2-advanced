# Lesson 3 — Partial Functions

Source: `src/lectures/part2afp/PartialFunctions.scala`

You already know that `{ case ... }` builds something pattern-matchable via
`unapply` (Lesson 2). This lesson shows a second job that same `{ case ... }`
syntax can do: it can build a `PartialFunction`, a function that openly admits
it isn't defined everywhere.

## The problem: functions that can't handle every input

```scala
val aFussyFunction = (x: Int) =>
  if (x == 1) 42
  else if (x == 2) 56
  else if (x == 5) 999
  else throw new FunctionNotApplicableException
```
(lines 10–16) A plain `Function1[Int, Int]` is supposed to map *every* `Int` to
some `Int`. Here that's a lie — the function only really knows about
`{1, 2, 5}`; everything else is handled by throwing. You can tidy the "only
knows about a few values" logic with pattern matching:

```scala
val aNicerFussyFunction = (x: Int) => x match {
  case 1 => 42
  case 2 => 56
  case 5 => 999
}
//  {1,2,5} => Int
```
(lines 18–23) This is nicer to read, but it's still a total `Int => Int` as
far as the type system is concerned — the compiler doesn't know the function
is only meaningful on `{1, 2, 5}`; a `MatchError` at runtime is the only
signal. Scala has a dedicated type for "this is a function, but only over
part of its domain."

## `PartialFunction[A, B]`

```scala
val aPartialFunction: PartialFunction[Int, Int] = {
  case 1 => 42
  case 2 => 56
  case 5 => 999
} // partial function value

println(aPartialFunction(2))
//  println(aPartialFunction(57273))
```
(lines 25–32) `PartialFunction[A, B]` is a *different type* than
`Function1[A, B]`, and it changes what `{ case ... }` gets built into. When
the compiler sees a `{ case ... }` block where a `PartialFunction[A, B]` is
expected, it desugars it not just into a match expression, but into an
object implementing two methods:

- `apply(x: A): B` — behaves like the match expression, but throws
  `scala.MatchError` (not your own exception) if nothing matches.
- `isDefinedAt(x: A): Boolean` — tells you, *without running the logic*,
  whether `apply` would succeed.

That second method is the whole point: it lets a caller check the domain
before crossing it, instead of relying on catching an exception. Calling
`aPartialFunction(57273)` (the commented-out line) would throw
`MatchError`, because 57273 isn't one of the cases — the domain really is
partial, and now the type says so.

## `isDefinedAt`: checking the domain without calling

```scala
println(aPartialFunction.isDefinedAt(67)) // false
```
(line 35) `isDefinedAt` is generated from the same `case` patterns —
essentially "would any of these cases match?" — without evaluating the
right-hand sides. This is what makes `PartialFunction` genuinely more useful
than "a function that might throw": you get a first-class, inspectable
notion of *where* the function is valid, which is exactly what lets HOFs
like `collect` (on `List`, `Option`, etc.) filter and transform in one pass
without try/catch.

## `lift`: turning partiality into `Option`

```scala
val lifted = aPartialFunction.lift // Int => Option[Int]
println(lifted(2))   // Some(56)
println(lifted(98))  // None
```
(lines 37–40) `lift` converts a `PartialFunction[A, B]` into a *total*
`Function1[A, Option[B]]`: defined inputs come back as `Some(result)`,
everything outside the domain comes back as `None` instead of throwing.
This is the standard way to make a partial function safe to call with
arbitrary input — you trade "might throw `MatchError`" for "always returns,
wrapped in `Option`," reusing the `Option` vocabulary you already know from
Lesson 0.

## `orElse`: chaining partial functions

```scala
val pfChain = aPartialFunction.orElse[Int, Int] {
  case 45 => 67
}

println(pfChain(2))  // 42 (handled by aPartialFunction)
println(pfChain(45)) // 67 (aPartialFunction wasn't defined here, so the fallback ran)
```
(lines 42–47) `orElse` builds a new `PartialFunction` that tries the
original first; if `isDefinedAt` is false there, it falls through to the
second one. This is how you compose several narrow partial functions into
one that covers a bigger (still possibly partial) domain — the partial-
function equivalent of stacking `case` clauses from multiple sources instead
of one big match block.

## `PartialFunction` *is* a `Function1`

```scala
val aTotalFunction: Int => Int = {
  case 1 => 99
}
```
(lines 51–53) Under the hood, `trait PartialFunction[-A, +B] extends
(A => B)`. So every `PartialFunction` can be used anywhere a `Function1` is
expected — you can assign the `{ case ... }` literal to an `Int => Int`
variable, as above, and it still works as a normal function via `apply`.
The catch: the type of the variable no longer advertises the partiality —
`aTotalFunction` claims to handle all `Int`s but will throw `MatchError` on
anything besides `1`. Whether you get `PartialFunction`'s extra safety
(`isDefinedAt`, `lift`, `orElse`) or not is decided by the **declared type**,
not by how the value was built.

## HOFs happily accept `{ case ... }` because of this subtyping

```scala
val aMappedList = List(1,2,3).map {
  case 1 => 42
  case 2 => 78
  case 3 => 1000
}
println(aMappedList) // List(42, 78, 1000)
```
(lines 56–61) `List.map` expects a `Function1[A, B]`. Because
`PartialFunction[A, B] <: Function1[A, B]`, a `{ case ... }` literal
type-checks directly as the argument to `map` — no explicit
`PartialFunction` annotation needed, since the expected type drives which
desugaring the compiler picks. This is exactly the same trick the chatbot
example at the bottom of the file uses with `.map(chatbot)` on stdin lines
(line 91).

> **Gotcha:** a `PartialFunction` can only have **one** parameter type
> (line 64 in the source: *"PF can only have ONE parameter type"*). There's
> no such thing as `PartialFunction[(A, B), C]` behaving like a two-argument
> partial function the way `Function2` does for total functions — if you
> need multiple parameters, you tuple them yourself.

## Building a `PartialFunction` by hand (no `{ case ... }` sugar)

```scala
val aManualFussyFunction = new PartialFunction[Int, Int] {
  override def apply(x: Int): Int = x match {
    case 1 => 42
    case 2 => 65
    case 5 => 999
  }

  override def isDefinedAt(x: Int): Boolean =
    x == 1 || x == 2 || x == 5
}
```
(lines 74–83) This is what the `{ case ... }` sugar expands to conceptually:
an anonymous `PartialFunction` implementation supplying both `apply` and
`isDefinedAt` yourself. Note that `isDefinedAt` and `apply` are written
*independently* — the compiler-generated version keeps them in sync
automatically from the same `case` list, but if you hand-roll a
`PartialFunction`, it's on you to make sure `isDefinedAt` really agrees with
what `apply` can handle. A `PartialFunction` that lies about its own domain
defeats the entire point of the type.

## Key takeaway

`PartialFunction[A, B]` is `Function1[A, B]` plus an honest, queryable
account of where it's valid (`isDefinedAt`). The `{ case ... }` literal
syntax builds one automatically from a list of `case` clauses, and because
`PartialFunction` is a subtype of `Function1`, that literal can be passed
anywhere a plain function is expected (`map`, a `val: Int => Int`, etc.) —
you just lose the extra safety (`isDefinedAt`, `lift`, `orElse`) unless the
declared type keeps it as a `PartialFunction`. Prefer `PartialFunction`
whenever "this only makes sense for some inputs" is actually true of your
logic — it turns a silent assumption into part of the type.

---

## Exercises

Try these in `src/playground/ScalaPlayground.scala` (or a scratch file):

1. Write a `PartialFunction[String, Int]` called `wordLength` that's defined
   only for `"one"`, `"two"`, `"three"` (mapping to `3`, `3`, `5`). Confirm
   `wordLength.isDefinedAt("four")` is `false`, then use `.lift` to safely
   look up `"four"` and get `None` instead of a `MatchError`.
2. Build two small partial functions over `Int` covering disjoint values
   (e.g. one for negatives, one for `0`), chain them with `orElse`, and add
   a third `orElse` fallback so the combined function is total. Verify with
   a few `isDefinedAt` checks and calls.
3. (Like the source's own exercise) Extend the file's `chatbot` idea:
   write your own `PartialFunction[String, String]` with 3–4 `case`s, then
   write a plain `def respond(input: String): String` that calls
   `chatbot.applyOrElse(input, (_: String) => "I don't understand.")`
   — look up what `applyOrElse` does and why it's more efficient than
   calling `isDefinedAt` followed by `apply` separately.
