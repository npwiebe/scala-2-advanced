# Lesson 28 — Structural Types

Source: `src/lectures/part5ts/StructuralTypes.scala`

Everything you've matched on and typed against so far — case classes, traits,
sealed hierarchies — is **nominal typing**: a value has type `T` because it
was declared `extends T` (or literally is a `T`). This lesson introduces the
opposite idea: a type defined purely by the *methods it exposes*, with no
shared trait or class in sight. If it has the right shape, it fits — that's
duck typing, Scala's way.

## 1. The refinement/structural type: `type X = { def method: ... }`

```scala
type UnifiedCloseable = {
  def close(): Unit
} // STRUCTURAL TYPE

def closeQuietly(unifiedCloseable: UnifiedCloseable): Unit = unifiedCloseable.close()

closeQuietly(new JavaCloseable {
  override def close(): Unit = ???
})
closeQuietly(new HipsterCloseable)
```
(lines 12–30) `UnifiedCloseable` isn't a class or trait — it's an anonymous
type described entirely by "anything with a zero-arg `close(): Unit`
method." `JavaCloseable` (an alias for `java.io.Closeable`, line 12) and
`HipsterCloseable` (line 14) share **no common supertype** you wrote — one is
a JDK interface, the other a plain class with `close()` and an unrelated
`closeSilently()`. Yet `closeQuietly` accepts both, because the compiler
checks the *shape*, not the ancestry.

Compare that to the commented-out line right above it:
```scala
//  def closeQuietly(closeable: JavaCloseable OR HipsterCloseable) // ?!
```
Without structural types your only nominal option would be an awkward "either
of these two unrelated types" signature — which Scala 2 doesn't even have
syntax for. The structural type sidesteps the whole problem: define the
*contract* (has a `close()`), not the *lineage*.

## 2. Type refinements: nominal type + extra structural requirement

```scala
type AdvancedCloseable = JavaCloseable {
  def closeSilently(): Unit
}

class AdvancedJavaCloseable extends JavaCloseable {
  override def close(): Unit = println("Java closes")
  def closeSilently(): Unit = println("Java closes silently")
}

def closeShh(advCloseable: AdvancedCloseable): Unit = advCloseable.closeSilently()

closeShh(new AdvancedJavaCloseable)
// closeShh(new HipsterCloseable)
```
(lines 37–49) `AdvancedCloseable` mixes both worlds: you still need to *be* a
`JavaCloseable` nominally, **and** structurally have a `closeSilently()`
method on top. This is called a **refinement type** — narrowing a named type
with extra structural constraints. `HipsterCloseable` has `closeSilently()`
but isn't a `JavaCloseable`, so `closeShh(new HipsterCloseable)` is commented
out — it wouldn't compile.

Gotcha: refinements read like anonymous subclassing (`Type { extra members
}`), but you're not creating a new named type anywhere else — the `{ }` block
is just narrowing the type signature itself, usable inline as a parameter
type too:
```scala
def altClose(closeable: { def close(): Unit }): Unit = closeable.close()
```
(line 52) — no `type` alias needed at all; the structural type can be written
directly where a type is expected.

## 3. It's genuine duck typing — no shared supertype required

```scala
type SoundMaker = {
  def makeSound(): Unit
}

class Dog {
  def makeSound(): Unit = println("bark!")
}

class Car {
  def makeSound(): Unit = println("vrooom!")
}

val dog: SoundMaker = new Dog
val car: SoundMaker = new Car
```
(lines 57–70) `Dog` and `Car` share nothing — no trait, no common base
besides `AnyRef`. Both are valid `SoundMaker`s purely because each has a
`makeSound(): Unit` method. "If it walks like a duck and quacks like a
duck..." — Scala calls this **static duck typing**: it's checked at compile
time (unlike Python/Ruby's fully dynamic duck typing), but the compatibility
rule is structural, not nominal.

## 4. The reflection caveat

```scala
import scala.language.reflectiveCalls
```
(line 3) This import is required specifically because structural types are
implemented under the hood using **Java reflection**. When you call
`unifiedCloseable.close()` on a value whose static type is a structural type,
the compiler can't emit a direct virtual-method-table call the way it does
for nominal types — it doesn't statically know which concrete class you'll
pass in. Instead it generates code that reflectively looks up a method named
`close` with a matching signature and invokes it at runtime.

Gotcha: this is why the feature lives behind an explicit language import —
the Scala compiler wants you to *opt in*, because:
- reflective calls are meaningfully **slower** than normal method dispatch
  (method lookup happens at runtime instead of being resolved to a direct
  call at compile time);
- they can fail at runtime in edge cases the type checker can't fully verify
  (though the common case here is safe).

Without the import, this file would give a compiler warning/error at every
structural type call site telling you reflection is involved and asking you
to acknowledge it via the import.

## 5. Combining structural types with generics

```scala
def f[T](somethingWithAHead: { def head: T }): Unit = println(somethingWithAHead.head)
```
(line 94) `f` doesn't ask for a *named* type with a `head` — it asks for
"anything with a `head: T`", where `T` is inferred from whatever you pass.
That means `f` type-checks against types that have never heard of each
other:

```scala
trait CBL[+T] { def head: T; def tail: CBL[T] }
case object CBNil extends CBL[Nothing] { def head: Nothing = ???; def tail: CBL[Nothing] = ??? }
case class CBCons[T](override val head: T, override val tail: CBL[T]) extends CBL[T]

class Human { def head: Brain = new Brain }
class Brain { override def toString: String = "BRAINZ!" }

f(CBCons(2, CBNil))   // T = Int
f(new Human)          // T = Brain !!
```
(lines 81–107) `CBCons` is a custom linked-list ADT; `Human` is a completely
unrelated class that happens to define a `head` returning a `Brain`. Neither
knows the other exists, and neither implements any shared "Headable" trait —
but both satisfy `{ def head: T }`, so `f` accepts both, inferring `T = Int`
for one call and `T = Brain` for the other. This is the payoff of pairing
generics with structural types: you write one polymorphic method that works
across an open-ended family of "things with a `head`," without forcing every
such type into a common hierarchy.

## 6. Where duck typing bites: lost type safety across two arguments

```scala
object HeadEqualizer {
  type Headable[T] = { def head: T }
  def ===[T](a: Headable[T], b: Headable[T]): Boolean = a.head == b.head
}

val brainzList = CBCons(new Brain, CBNil)
val stringsList = CBCons("Brainz", CBNil)

HeadEqualizer.===(brainzList, new Human)        // fine: both give T = Brain
HeadEqualizer.===(new Human, stringsList)        // compiles! not type safe
```
(lines 110–124) `===` is generic over a single `T` shared by both
parameters, so `brainzList` (a `CBL[Brain]`) and `new Human` (whose `head` is
also a `Brain`) unify at `T = Brain` and the comparison is meaningful.

But the last line is the real lesson: `new Human` has `head: Brain` and
`stringsList` has `head: String` — two *different* concrete types — yet the
call still compiles. The compiler doesn't reject it outright; it infers `T`
as some common supertype of `Brain` and `String` (in practice `Any`, or
`Object`/`AnyRef`), and the structural check passes because both sides
*have* a `head` of *some* type. You end up comparing a `Brain` to a `String`
with `==`, which will simply always be `false` — a bug the type system was
supposed to catch but didn't, because duck typing only verifies "has the
right method shape," not "has the type I actually meant."

## Nominal vs. structural: when duck typing earns its keep

With case classes/traits (Lessons covering pattern matching and inheritance)
you get real safety: the compiler checks against a name you declared, `==`
comparisons and exhaustiveness checks reflect a hierarchy you control, and
there's no reflection tax. Reach for structural types only when:

- you're bridging types you **don't control** and can't retrofit a common
  trait onto (e.g. a JDK class and a third-party library class that both
  happen to expose `close()`, as with `JavaCloseable`/`HipsterCloseable`
  above);
- you want a method to accept "anything shaped like X" as a lightweight,
  ad-hoc constraint, and you're willing to pay the reflection cost and accept
  weaker type-safety guarantees at the boundaries (as `HeadEqualizer` shows).

If you *can* define a shared trait, do that instead — nominal typing is
faster and catches more mistakes at compile time.

## Key takeaway

A structural type `{ def method: T }` describes a shape, not a lineage —
any type with a matching method satisfies it, with zero shared ancestry
required. The compiler implements this via reflection (hence
`scala.language.reflectiveCalls`), which is why it's slower than ordinary
dispatch and why Scala makes you opt in explicitly. Refinement types
(`Nominal { extra structural members }`) let you combine a real supertype
requirement with extra structural constraints. Structural types compose with
generics beautifully (`f[T](x: { def head: T })`), letting you write one
method against an open family of unrelated types — but as `HeadEqualizer`
shows, that same open-endedness can let unrelated concrete types unify at a
too-broad inferred `T`, silently defeating the type safety you'd get from a
real nominal type.

---

## Exercises

1. Define a structural type `type Flyable = { def fly(): String }`. Write two
   unrelated classes, `Bird` and `Drone`, each with a `fly(): String` method
   but no shared trait. Write a `def launch(f: Flyable): Unit` that prints the
   result of calling `fly()`, and call it with both. Then add a third class
   `Rocket` with a `fly(altitude: Int): String` (different signature) and
   confirm it does *not* type-check against `Flyable`.
2. Take `AdvancedCloseable` from the file (`JavaCloseable { def closeSilently(): Unit }`)
   and write a second refinement, `type LoudCloseable = HipsterCloseable { def bang(): Unit }`.
   Create a class that satisfies it and one that's missing `bang()`; confirm
   the compiler rejects the second.
3. (Harder) Reproduce the `HeadEqualizer` type-safety hole yourself: define
   `type Sized[T] = { def size: T }`, then a method
   `def sameSize[T](a: Sized[T], b: Sized[T]): Boolean = a.size == b.size`.
   Call it with one object whose `size` is an `Int` and another whose `size`
   is a `String`. Confirm it compiles, explain (in a comment) what `T` gets
   inferred as and why the comparison is always `false`, then fix the
   signature so mismatched types are rejected at compile time (hint: two
   separate type parameters with a stricter bound, or drop structural typing
   for a real trait).
