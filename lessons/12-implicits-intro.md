# Lesson 12 — Implicits Intro

Source: `src/lectures/part4implicits/ImplicitsIntro.scala`

Implicits are Scala's mechanism for letting the compiler fill in a gap in your
code automatically — either by *converting* a value to a type that has the
method you called, or by *supplying an argument* you didn't write. This one
mechanism (in its two flavors) is the foundation for lessons 13–20: implicit
classes, type classes, JSON serialization, the magnet pattern, and Scala/Java
conversions all boil down to "the compiler is silently calling something
`implicit` for me." If this lesson doesn't click, none of those will make
sense, so slow down here.

## 1. Implicit conversions with `implicit def`

```scala
case class Person(name: String) {
  def greet = s"Hi, my name is $name!"
}

implicit def fromStringToPerson(str: String): Person = Person(str)

println("Peter".greet) // println(fromStringToPerson("Peter").greet)
```
`String` has no `greet` method. Normally `"Peter".greet` would be a compile
error. But because `fromStringToPerson` is marked `implicit` and is in scope,
the compiler's fallback plan kicks in: *before* giving up, it looks for an
implicit function `String => T` where `T` has a `greet` method, finds
`fromStringToPerson`, and silently rewrites your call to
`fromStringToPerson("Peter").greet`. You never call the conversion by name —
that's the whole point. This is the mechanism that makes `1 -> 2` valid (line
9): `->` isn't a method on `Int`, it's added by an implicit conversion to
`ArrowAssoc` from `scala.Predef`, the same trick as `fromStringToPerson` here,
just already built into the standard library.

Gotcha: the compiler will only reach for an implicit conversion as a *last
resort*, after it has confirmed the method truly doesn't exist directly (or
via inheritance) on the value's actual type. It also only tries **one**
implicit conversion at a time — it will not chain two implicit conversions
together to make an expression compile. If two applicable implicit defs are in
scope at once (an ambiguity), compilation fails rather than guessing.

## 2. Why not just overload the type?

The commented-out block in the source (lines 19–22) is worth reading
literally:

```scala
//  class A {
//    def greet: Int = 2
//  }
//  implicit def fromStringToA(str: String): A = new A
```
This shows the danger, not a feature: if you had *two* implicit conversions
from `String` in scope — one to `Person` (with a `greet: String`) and one to
`A` (with a `greet: Int`) — and you wrote `"Peter".greet`, the compiler would
have two equally valid ways to make the code compile and would refuse,
reporting an ambiguous implicit conversion. Implicit conversions are powerful
precisely because they're invisible, which means *conflicting* ones produce
confusing errors far from where you'd expect. Keep the number of implicit
conversions active in any given scope small.

## 3. Implicit parameters — a different mechanism entirely

```scala
def increment(x: Int)(implicit amount: Int) = x + amount
implicit val defaultAmount = 10

increment(2)
```
This is a completely separate feature that happens to reuse the same keyword.
`increment` takes a *curried* second parameter list, and that list is marked
`implicit`. When you call `increment(2)` and don't supply the second list at
all, the compiler searches the implicit scope for a value of type `Int`
marked `implicit`, finds `defaultAmount`, and passes it in for you — the call
becomes `increment(2)(defaultAmount)`. You're not converting a mismatched
type into something usable; you're letting the compiler *find and inject an
argument* your code never explicitly names.

Gotcha — **this is explicitly not the same as a default argument.** The
source even calls this out with a comment on line 29 (`// NOT default args`).
The differences matter:
- A default argument (`def increment(x: Int, amount: Int = 10)`) bakes the
  fallback value into the method definition itself — every caller who omits
  it gets exactly `10`, always.
- An implicit parameter has no built-in fallback; it depends entirely on
  *what implicit value happens to be in scope at the call site*. Change which
  `implicit val` is imported or defined nearby, and `increment(2)` produces a
  different result without touching `increment`'s definition at all.

That's a feature, not a nuisance: it lets a library author write a method
once and let each *consuming module* configure its own implicit behavior
(execution contexts for `Future`, `Ordering`s for `sorted`, JSON encoders,
etc.) — the entire subject of the next several lessons.

## 4. Two flavors, one keyword — how to tell them apart

| | Implicit conversion | Implicit parameter |
|---|---|---|
| Marked on | a `def` (or class, see Lesson 13's `implicit class`) that transforms `A => B` | a parameter (usually in its own `(implicit ...)` list) |
| Triggers when | you call a method that doesn't exist on the value's type | you omit an argument the method needs |
| What the compiler does | wraps your value in a call to the conversion function | looks up a value of the needed type and passes it |
| Example here | `fromStringToPerson` | `amount` in `increment` |

Both are resolved by the same underlying search process — "find something
`implicit` whose type fits" — which is why they share a keyword even though
what they *do* is different.

## 5. Where does the compiler even look? (preview)

`ImplicitsIntro.scala` only ever has one implicit candidate in scope at a
time, so it doesn't need to demonstrate the search order — but you should
know it's already happening even here. When the compiler needs an implicit
value or conversion, it checks, roughly:

1. **Local scope** — implicits declared or imported directly in the
   enclosing block (this is *all* that's happening in this file:
   `fromStringToPerson` and `defaultAmount` are both local top-level
   declarations).
2. **Imported scope** — anything brought in via an `import`, including
   Scala's own implicit conversions from `scala.Predef` (that's how `1 -> 2`
   works without you importing anything explicitly — `Predef` is
   auto-imported).
3. **Companion objects of the types involved** — once you're passing around
   your own types (e.g. an `Ordering[Person]`), the compiler will also check
   the companion object of `Person`, of `Ordering`, and of any type parameter
   involved.

That last point is the real subject of the next lesson,
`src/lectures/part4implicits/OrganizingImplicits.scala` (Lesson 13), where
you'll see `List(1,4,5,3,2).sorted` reach for an implicit `Ordering[Int]`, and
learn how to organize multiple competing `Ordering`s using companion objects
vs. named objects you `import` explicitly. Don't worry about mastering scope
rules yet — just notice now that "the compiler searched somewhere and found
something" is already happening in *this* lesson, twice.

## Key takeaway

`implicit` is overloaded to mean two different things, and this lesson
introduces both: an `implicit def` lets the compiler silently convert a value
to a type that has the method you actually called (implicit conversion); an
`implicit` parameter lets the compiler silently supply an argument by
searching for a value of the right type already in scope (implicit
parameter). Neither has a hardcoded fallback like a default argument does —
both depend on *what's in scope*, which is powerful (it lets library code
adapt to each caller's context) and dangerous (two competing implicits of the
same type cause an ambiguity error). Everything from Lesson 13 onward is
about disciplining that "what's in scope" question.

---

## Exercises

1. Write an `implicit def` that converts `Int` to a `Currency` case class
   wrapping a `cents: Int` field, giving `Currency` a `toDollarString` method.
   Confirm `5.toDollarString` compiles and prints `"$0.05"` (say what the
   compiler rewrites this call to internally).
2. Reproduce the `increment` example but with two implicit `Int` values in
   scope at once (e.g. one at the top level, one inside a nested `object`).
   Try calling `increment(2)` from inside the nested object and predict —
   then verify — which one wins, and why that's not an ambiguity error the
   way two competing implicit *conversions* would be.
3. Write a method `def describe(x: Int)(implicit label: String) = s"$label: $x"`
   with an `implicit val label = "value"` in scope. Call it once letting the
   implicit fill in, and once by explicitly passing `describe(5)("override")`.
   Confirm both compile, and explain in a sentence why explicitly passing the
   argument is allowed even though the parameter list is marked `implicit`.
