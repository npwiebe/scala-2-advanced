# Lesson 13 — Organizing Implicits

Source: `src/lectures/part4implicits/OrganizingImplicits.scala`

Lesson 12 covered *what* an implicit parameter is and how the compiler fills
one in. This lesson covers something that matters the moment you have more
than one candidate lying around: *where* the compiler looks for implicits,
in what order, and where you as a library/API author should actually put
them so callers get sane defaults without losing the ability to override
them. The running example throughout is `Ordering[T]`, the type class behind
`.sorted`.

## 1. Any `val`/`object`/parameterless `def` can be implicit

```scala
implicit def reverseOrdering: Ordering[Int] = Ordering.fromLessThan(_ > _)

println(List(1,4,5,3,2).sorted)
```
(lines 8–11) `List(1,4,5,3,2).sorted` needs an `implicit ord: Ordering[Int]`
in scope. The comment block at lines 15–20 spells out the full list of shapes
an implicit can take: `val`/`var`, `object`, or an accessor `def` (no
parentheses). `reverseOrdering` is a `def`, so it qualifies — the compiler
calls it to manufacture the `Ordering[Int]` value each time it's needed, same
as if it were a `val`. Because it's the only implicit `Ordering[Int]` visible
here, `.sorted` picks it up and the list comes out **descending**, which is
worth staring at: nothing about `.sorted` looks like it should reverse the
list, but an implicit quietly changed its behavior.

## 2. Only one implicit may match — ambiguity is a compile error

```scala
implicit def reverseOrdering: Ordering[Int] = Ordering.fromLessThan(_ > _)
//  implicit val normalOrdering: Ordering[Int] = Ordering.fromLessThan(_ < _)
```
The second line (line 9) is commented out for a reason: if you uncomment it,
you now have **two** `Ordering[Int]` implicits in local scope, and
`List(...).sorted` no longer compiles — the compiler refuses to guess which
one you meant. This is the core constraint that "organizing implicits" exists
to manage: implicit resolution is not "pick the best match," it's "there must
be exactly one candidate in the winning scope, or it's an error." Every rule
below is really about controlling how many candidates are visible at once.

Gotcha: this isn't "last one wins" or "most specific wins" the way overload
resolution sometimes feels — for a single scope, two applicable implicits of
the exact same type is simply ambiguous and fails to compile.

## 3. The implicit search order

```scala
/*
  Implicit scope
  - normal scope = LOCAL SCOPE
  - imported scope
  - companions of all types involved in the method signature
    - List
    - Ordering
    - all the types involved = A or any supertype
 */
// def sorted[B >: A](implicit ord: Ordering[B]): List[B]
```
(lines 37–46) When the compiler needs an implicit parameter, it searches in
this priority order, stopping at the first scope that produces exactly one
candidate:

1. **Local scope** — implicits defined or in scope in the current block/file
   (like `reverseOrdering` above).
2. **Imported scope** — implicits pulled in via `import`.
3. **Companion objects of all types involved in the method signature** — for
   `sorted[B >: A](implicit ord: Ordering[B]): List[B]`, that means the
   companion of `List`, the companion of `Ordering`, and the companion of `B`
   (the element type, or any of its supertypes). This is why `Ordering[Int]`
   defined in `Person`'s companion works without an import: `Person` is one
   of "the types involved."

Local scope always wins if present, which is exactly why `reverseOrdering`
overrides whatever a companion object might have suggested — a fact the rest
of the lesson leans on heavily.

## 4. Where you, the author, should put an implicit: companion object

```scala
case class Purchase(nUnits: Int, unitPrice: Double)
object Purchase {
  implicit val totalPriceOrdering: Ordering[Purchase] =
    Ordering.fromLessThan((a,b) => a.nUnits * a.unitPrice < b.nUnits * b.unitPrice)
}
```
(lines 67–70) If a type has one *obviously correct* default ordering, define
it as an implicit inside that type's own companion object. Callers get it for
free — no import needed — because rule 3 above always checks the companion of
every type involved. For `Purchase`, ordering by total price (`nUnits *
unitPrice`) is the natural default (the comment at lines 61–63 notes this is
the "most used, 50%" case), so it lives right on `Purchase`.

## 5. Where to put alternatives: a dedicated importable object

```scala
object AlphabeticNameOrdering {
  implicit val alphabeticOrdering: Ordering[Person] =
    Ordering.fromLessThan((a, b) => a.name.compareTo(b.name) < 0)
}

object AgeOrdering {
  implicit val ageOrdering: Ordering[Person] =
    Ordering.fromLessThan((a, b) => a.age < b.age)
}

import AgeOrdering._
println(persons.sorted)
```
(lines 48–57) `Person` has no single "correct" ordering — sometimes you want
alphabetical, sometimes by age — so neither belongs baked into `Person`'s
companion (that's why the companion-based version is commented out at lines
31–34). Instead, each alternative gets its own small object, and the caller
picks which one they want with a plain `import`. Because imported scope
(rule 3, step 2) outranks companion scope (step 3), an explicit `import
AgeOrdering._` is guaranteed to win over anything `Person`'s companion might
otherwise contribute — this is the mechanism, not a coincidence.

The `Purchase` example repeats this pattern for the two non-default 25%
cases (lines 72–78): `UnitCountOrdering` and `UnitPriceOrdering` sit outside
`Purchase`, ready to be imported when the total-price default isn't what you
want.

Gotcha: this only works cleanly if you don't import two competing orderings
into the same scope — that recreates the ambiguity from section 2, just via
imports instead of local `val`s.

## Key takeaway

Implicit resolution checks local scope, then imported scope, then the
companion objects of every type mentioned in the signature — and at each
scope it demands exactly one match. That ranking gives you a design tool:
put the *one* sensible default implicit in the type's own companion object
(free for every caller), and put every *situational* alternative in its own
named object that callers `import` only when they specifically want it.
Local/imported implicits always beat companion-object ones, so importing an
alternative is a safe, deliberate override — not a coin flip.

---

## Exercises

1. Write a `case class Movie(title: String, year: Int, rating: Double)`.
   Give it a default `Ordering[Movie]` in its companion object (pick the
   field that feels like "the" natural sort). Then write two more `object`s,
   `ByYear` and `ByRating`, each with an alternative implicit `Ordering[Movie]`,
   and demonstrate importing each one to sort the same `List[Movie]` three
   different ways.
2. Take the commented-out lines 31–34 in `OrganizingImplicits.scala`
   (`Person`'s companion `alphabeticOrdering` plus a local `ageOrdering`) and
   predict, before running anything, which one wins if both are uncommented
   at the same time and no extra import is added. Then verify by reasoning
   through the search order — don't just run the code.
3. Deliberately create an ambiguous-implicits compile error: define two
   `implicit val`s of type `Ordering[String]` in the same local scope and
   try to call `.sorted` on a `List[String]`. Read the compiler error
   message and explain in your own words why "the compiler should just pick
   one" is not how this works.
