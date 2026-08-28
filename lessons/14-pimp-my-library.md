# Lesson 14 — Pimp My Library

Source: `src/lectures/part4implicits/PimpMyLibrary.scala`

Lesson 12 introduced implicit classes as a way to bolt an extra method onto a
type. This lesson is about *why that trick exists at all*: it's the standard
technique for extending types you don't own — `Int`, `String`, anything from
the standard library or a third-party jar — without touching their source or
subclassing them. The Scala community calls this "pimping" a library, and
it's exactly the mechanism behind syntax you've probably already used, like
`3.seconds` from `scala.concurrent.duration`.

## 1. The core idea: extension methods via implicit classes

```scala
implicit class RichInt(val value: Int) extends AnyVal {
  def isEven: Boolean = value % 2 == 0
  def sqrt: Double = Math.sqrt(value)
  ...
}

42.isEven // new RichInt(42).isEven
```
(lines 10–12, 41)

`Int` doesn't have an `isEven` method. `RichInt` does, and it wraps an `Int`.
When you write `42.isEven`, the compiler can't find `isEven` on `Int`, so it
looks for an implicit conversion that would make the call type-check — finds
`RichInt`, wraps `42` in `new RichInt(42)`, and calls `isEven` on *that*.
Nothing about `Int` changed; you added a method to it from the outside. This
is "type enrichment" — the file's own comment at line 42 literally calls it
"pimping."

## 2. The one-constructor-parameter rule

```scala
implicit class RichInt(val value: Int) extends AnyVal { ... }
```
An implicit class **must** take exactly one parameter in its primary
constructor. That parameter is the value being implicitly wrapped. This
isn't a style preference — it's a hard compiler restriction, because the
whole mechanism depends on the compiler being able to say "I have an `Int`
here, I need something with an `isEven` method, let me build a `RichInt` by
passing that one `Int` in." If the constructor took two parameters, there'd
be no unambiguous way to synthesize the second one, so the feature would stop
working. `extends AnyVal` here is a separate, optional optimization (a value
class — the wrapper gets erased at compile time when possible, so `42.isEven`
doesn't actually allocate a `RichInt` at runtime); it's not what makes the
implicit class legal.

## 3. Stacking enrichments (and why it doesn't compose further)

```scala
implicit class RicherInt(richInt: RichInt) {
  def isOdd: Boolean = richInt.value % 2 != 0
}

// 42.isOdd   // does NOT compile
```
(lines 35–37, 50)

You can even write an implicit class whose constructor parameter is *another*
implicit-class type — `RicherInt` wraps a `RichInt`. In principle
`42.isOdd` should work by chaining two implicit conversions: `Int → RichInt →
RicherInt`. It doesn't compile, and the file calls this out directly at line
49: **the compiler only performs one implicit search/conversion per call
site.** It will find `RichInt` to satisfy `.isEven`, but it won't then search
*again* from `RichInt` to `RicherInt` to satisfy `.isOdd`. This is a real
limitation to internalize — don't design APIs assuming implicit conversions
chain.

Gotcha: this is a different rule from "implicit *parameters* can recursively
depend on other implicits" (which does chain, and which you'll see with
implicit parameter resolution). The one-conversion-at-a-time limit specifically
applies to *implicit conversions/enrichments* used to make a method call
type-check.

## 4. Enriching more than one type in the same file

```scala
implicit class RichString(string: String) {
  def asInt: Int = Integer.valueOf(string)
  def encrypt(cypherDistance: Int): String =
    string.map(c => (c + cypherDistance).asInstanceOf[Char])
}

println("3".asInt + 4)        // 7
println("John".encrypt(2))    // "Lqjp"
```
(lines 65–71)

Nothing restricts pimping to one type per file, or one implicit class per
type. `RichString` does the same trick for `String` that `RichInt` does for
`Int`: `asInt` gives you a quick numeric parse, and `encrypt` does a Caesar
shift by mapping each `Char` forward by `cypherDistance` and casting back.
Neither method exists on the real `java.lang.String`/`scala.Predef.String` —
they're synthesized the same way `isEven` was.

## 5. Enriching with more interesting shapes: higher-order and generic methods

```scala
def times(function: () => Unit): Unit = {
  def timesAux(n: Int): Unit =
    if (n <= 0) ()
    else { function(); timesAux(n - 1) }
  timesAux(value)
}

def *[T](list: List[T]): List[T] = {
  def concatenate(n: Int): List[T] =
    if (n <= 0) List() else concatenate(n - 1) ++ list
  concatenate(value)
}
```
```scala
3.times(() => println("Scala Rocks!"))
println(4 * List(1,2))   // List(1, 2, 1, 2, 1, 2, 1, 2)
```
(lines 14–31, 73–74)

Enrichment isn't limited to trivial one-liners. `times` takes a `() => Unit`
callback and repeats it `value` times via a private recursive helper —
turning `3.times(...)` into a mini for-loop DSL on `Int`. `*` is even more
interesting: it *overloads* an existing operator symbol. `Int` already has
multiplication, but this defines `*` for the specific argument shape
`List[T]`, so `4 * List(1,2)` type-checks as "repeat this list 4 times and
concatenate" rather than colliding with numeric `*`. This is a preview of
operator overloading via enrichment, and it's exactly how a library gives you
new infix operators on existing types.

## 6. Implicit classes are sugar over `implicit def` conversions

```scala
// equivalent: implicit class RichAltInt(value: Int)
class RichAltInt(value: Int)
implicit def enrich(value: Int): RichAltInt = new RichAltInt(value)
```
(lines 80–82)

`implicit class Foo(x: X) { ... }` is itself just sugar: the compiler
generates a plain class `Foo` plus an `implicit def` conversion method from
`X` to `Foo`. The file proves this by writing the desugared form by hand.
Knowing this equivalence matters because it explains *why* the
one-constructor-parameter rule exists (an implicit conversion method takes
exactly one argument) and it tells you these two techniques — implicit
classes and implicit conversion methods — are the same underlying feature
with different amounts of boilerplate.

You can also skip the wrapper class entirely and enrich by converting
directly to an existing type:

```scala
implicit def stringToInt(string: String): Int = Integer.valueOf(string)
println("6" / 2)   // stringToInt("6") / 2 == 3
```
(lines 77–78)

Here there's no new method being added — `"6" / 2` doesn't type-check as-is,
so the compiler converts `"6"` straight to an `Int` (which already has `/`)
via `stringToInt`. Same mechanism, used to make one type *substitute* for
another rather than to attach new methods.

## Gotcha: implicit conversions can silently break type safety

```scala
implicit def intToBoolean(i: Int): Boolean = i == 1

val aConditionedValue = if (3) "OK" else "Something wrong"
println(aConditionedValue)   // "Something wrong"
```
(lines 85–92)

This compiles. `if` expects a `Boolean`; `3` is an `Int`; the compiler finds
`intToBoolean` in scope and silently rewrites the condition to
`intToBoolean(3)`, which is `false`. The file's own comment calls this the
"danger zone," and for good reason: nothing in the call site (`if (3) ...`)
hints that a conversion happened. A stray implicit `Int => Boolean` sitting
in scope can make `if (someCounter) ...` compile when it should have been a
type error and caught a bug. This is the standard argument for keeping
implicit conversions narrowly scoped (import them explicitly at the call
site) rather than defining broad, ambient ones like this.

## Real-world relevance

This is not a toy technique. `import scala.concurrent.duration._` followed by
`3.seconds` (line 47 of the source) is a `RichInt`-style implicit class
living in the standard library, converting an `Int` into a `Duration`-aware
wrapper with a `.seconds` method. Any time you see fluent, DSL-like syntax
grafted onto a built-in type — `1.day`, `"foo".shouldBe(...)` in test
frameworks, `10.pounds` in a units library — it's this exact pattern:
someone wrote an implicit class wrapping the type they don't own, and the
compiler inserts the conversion invisibly at every call site.

## Key takeaway

Implicit classes are the idiomatic way to extend a *closed* type (one you
can't subclass or edit) with new methods, and the compiler enforces the
mechanism by requiring exactly one constructor parameter — that parameter is
what gets implicitly synthesized from the value at the call site. Under the
hood it's nothing more than an `implicit def` conversion plus a wrapper
class, which is why exactly one implicit conversion is ever chained per call
— never two. The power is real (fluent DSLs, `3.seconds`, custom operators
like `*` on `Int`), but so is the risk: an implicit conversion into `Boolean`
or another type the compiler expects can hide real bugs behind code that
still type-checks.

---

## Exercises

1. Write an implicit class `RicherString(string: String)` that adds a
   `discount(percent: Int): String` method to `String`, where the string
   represents a price like `"100"` and the method returns a new numeric
   string with the percentage subtracted (e.g. `"100".discount(20)` →
   `"80"`). Confirm it works by calling it directly on a string literal.
2. Add a second implicit class to the same object that wraps *your*
   `RicherString`'s companion type (the way `RicherInt` wraps `RichInt` in
   the source), adding one more method — then try calling that method
   directly on a raw `String` literal and confirm it fails to compile.
   Explain in a comment why, referencing the "one implicit conversion per
   call" rule.
3. Write your own `implicit def` (not an implicit class) that converts
   `Boolean` to `Int` (`true -> 1`, `false -> 0`), import nothing else, and
   find an expression where this conversion lets code compile that
   probably shouldn't (mirroring the `intToBoolean` danger-zone example).
   Then delete the conversion and note what error appears instead.
