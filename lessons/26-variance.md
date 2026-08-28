# Lesson 26 — Variance

Source: `src/lectures/part5ts/Variance.scala`

Variance answers one question: if `Dog <: Animal`, what's the relationship
between `MyList[Dog]` and `MyList[Animal]`? The answer isn't automatic — it's
something *you* declare on the type parameter, and getting it wrong either
gets your code rejected by the compiler or (if the language let you get away
with it) would let you smuggle the wrong object into a container at runtime.
This lesson is dense because there are really three separate ideas stacked on
top of each other: declaring variance, the soundness problem that variance
annotations exist to prevent, and the "variance positions" rule the compiler
enforces to make covariant/contravariant types safe to use at all.

## 1. The three flavors, and what "substitutability" means

```scala
class Cage[T]              // invariant
class CCage[+T]             // covariant
val ccage: CCage[Animal] = new CCage[Cat]

class XCage[-T]              // contravariant
val xcage: XCage[Cat] = new XCage[Animal]
```
(lines 16–28)

Given `Dog <: Animal` (i.e. `Dog` is a subtype of `Animal`):

- **Invariant** `Cage[T]`: `Cage[Dog]` and `Cage[Animal]` have *no*
  subtyping relationship at all, even though `Dog` and `Animal` do. This is
  the default for a bare `class Cage[T]`.
- **Covariant** `CCage[+T]`: the subtyping of the type parameter carries
  over in the *same* direction — `CCage[Dog] <: CCage[Animal]`. That's why
  a `CCage[Cat]` can be assigned where a `CCage[Animal]` is expected on
  line 19: the `+` says "a cage of a more specific animal IS-A cage of a
  more general animal."
- **Contravariant** `XCage[-T]`: the relationship *flips* —
  `XCage[Animal] <: XCage[Cat]`. That's why line 28 assigns an
  `XCage[Animal]` to a variable typed `XCage[Cat]`. This feels backwards
  the first time you see it — more on why it's actually correct below.

`List` in the standard library is declared `List[+A]` for exactly this
reason: it's extremely convenient for a `List[Cat]` to be usable anywhere a
`List[Animal]` is expected (e.g. passing a `List[Cat]` to a method that
takes `List[Animal]`). Immutability is what makes this *safe* — see the
mutable-container problem below.

```
Given:  Cat <: Animal

                                Cat <: Animal   implies:
Covariant      CCage[+T]   ──▶  CCage[Cat]  <:  CCage[Animal]     (same direction as T)
Invariant      Cage[T]     ──▶  Cage[Cat]   and Cage[Animal]  — unrelated, no <: either way
Contravariant  XCage[-T]   ──▶  XCage[Animal] <:  XCage[Cat]      (FLIPPED direction from T)
```
Covariant "points the same way" as the element type's own subtyping;
contravariant "points backwards." Everything else in this lesson is either
justifying why the backwards direction is sometimes the *safe* one
(functions/consumers, next section) or explaining what the compiler forbids
so that neither direction can be abused (the variance positions rule,
section 4).

## 2. Why contravariance is the right shape for functions

`Function1` in the standard library is declared
`trait Function1[-T1, +R]` — contravariant in its argument, covariant in
its result. `AnotherContravariantCage` in the source models the argument
side of that:

```scala
class AnotherContravariantCage[-T] {
  def addAnimal(animal: T) = true
}
val acc: AnotherContravariantCage[Cat] = new AnotherContravariantCage[Animal]
acc.addAnimal(new Cat)
class Kitty extends Cat
acc.addAnimal(new Kitty)
```
(lines 60–66)

The intuition: an `AnotherContravariantCage[Animal]` (or a
`Function1[Animal, R]`) is a thing that knows how to handle *any* `Animal`
— so it can certainly handle a `Cat` or a `Kitty` too. A handler that
accepts a broader input is safe to use wherever a handler for a narrower
input was expected. That's why "accepting a more general type" is the safe
direction for something that *consumes* a value, and it's why
`Function1`'s parameter position is `-T1`: a `String => Int` can stand in
for an `Animal => Int`'s caller only if... actually the concrete case here
is simpler to hold onto: `acc` is declared to only need to handle `Cat`s,
but the object underneath can handle any `Animal`, which is more than
enough.

## 3. Invariance and the classic mutable-array unsoundness

```scala
class ICage[T]
//  val icage: ICage[Animal] = new ICage[Cat]
//  val x: Int = "hello"
```
(lines 22–24, commented out because they don't compile)

Why can't `Array[Cat]` (or any mutable, invariant-if-it-were-covariant
container) safely be treated as an `Array[Animal]`? Walk through what would
happen if the compiler allowed it:

```scala
// hypothetically, if Array were covariant and this compiled:
val cats: Array[Cat] = Array(new Cat)
val animals: Array[Animal] = cats        // pretend this were legal
animals(0) = new Dog                     // writing a Dog into an Array[Cat]!
val c: Cat = cats(0)                     // runtime type error — it's actually a Dog
```

This is exactly why `Array` (and any mutable box like a `var`-backed cell)
is invariant in real Scala: `T` shows up in both a "read" position (`get`)
and a "write" position (`set`/`update`), and those two positions pull the
variance in opposite directions. A read-only, immutable structure like
`List` only ever produces `T`s, never accepts one from the outside after
construction, so it's free to be covariant.

The lecture's `InvariantVariableCage` makes the same point directly by
showing what's *forbidden*:

```scala
//  class CovariantVariableCage[+T](var animal: T) // types of vars are in CONTRAVARIANT POSITION
/*
  val ccage: CCage[Animal] = new CCage[Cat](new Cat)
  ccage.animal = new Crocodile
 */

class InvariantVariableCage[T](var animal: T) // ok
```
(lines 40–50)

If `CovariantVariableCage[+T]` with a mutable `var animal: T` were legal,
you could hold a `CovariantVariableCage[Animal]` that's really backed by a
`Cat`, and then write a `Crocodile` into it through the `Animal`-typed
handle — corrupting the underlying `Cat` cage with a `Crocodile`. The
compiler refuses to let `var animal: T` exist inside a `+T` class at all,
for the same reason `Array` can't be covariant.

**Gotcha:** the comment "types of vars are in CONTRAVARIANT POSITION" is
talking about the *setter* half of a `var` (`animal_=(value: T)`) — a
setter is a method that takes `T` as a parameter, so it inherits the
method-argument rule from section 4 below. A `var` is really a getter
(covariant-safe) glued to a setter (needs contravariant-safe, i.e. `T` must
not be a strict covariant position) — mixing both uses in one class field
forces `T` to be invariant.

## 4. The variance positions rule

This is the mechanical rule the compiler actually checks, and it's the
crux of the whole lesson:

> **Method arguments are in contravariant position. Method return types
> are in covariant position.**
>
> (lines 99–103)

```
class SomeClass[+T] {
  def method(x: T): R     // T is a PARAMETER  → contravariant position → FORBIDDEN for +T
  def method(): T         // T is the RETURN   → covariant position     → allowed for +T
}

class OtherClass[-T] {
  def method(x: T): R     // T is a PARAMETER  → contravariant position → allowed for -T
  def method(): T         // T is the RETURN   → covariant position     → FORBIDDEN for -T
}
```

Concretely:
- Inside a class parameterized `+T` (covariant), `T` **cannot** appear as
  the type of a method *parameter*.
- Inside a class parameterized `-T` (contravariant), `T` **cannot** appear
  as a method's *return type*.

The lecture demonstrates the covariant side with `AnotherCovariantCage`:

```scala
//  trait AnotherCovariantCage[+T] {
//    def addAnimal(animal: T) // CONTRAVARIANT POSITION
//  }
/*
  val ccage: CCage[Animal] = new CCage[Dog]
  ccage.add(new Cat)
 */
```
(lines 52–58)

If this compiled, `ccage` is really a `CCage[Dog]` viewed through an
`Animal`-shaped window (legal, because `CCage` is covariant), but then
`ccage.add(new Cat)` would let you shove a `Cat` into a container that's
actually holding `Dog`s. The parameter type `T` in `addAnimal(animal: T)`
is a *contravariant position* (an input), and covariant type parameters
are barred from contravariant positions — so the compiler rejects the
class definition itself, before you even get to write the unsound call.

And the mirror image on the contravariant side, with `PetShop`:

```scala
class PetShop[-T] {
  //    def get(isItaPuppy: Boolean): T // METHOD RETURN TYPES ARE IN COVARIANT POSITION
  /*
    val catShop = new PetShop[Animal] {
      def get(isItaPuppy: Boolean): Animal = new Cat
    }

    val dogShop: PetShop[Dog] = catShop
    dogShop.get(true)   // EVIL CAT!
   */

  def get[S <: T](isItaPuppy: Boolean, defaultAnimal: S): S = defaultAnimal
}
```
(lines 80–92)

If `get(isItaPuppy: Boolean): T` were legal on `PetShop[-T]`, then
`dogShop: PetShop[Dog] = catShop` is fine by contravariance (a shop that
can produce/handle any `Animal` can stand in for one that only needs to
handle `Dog`), but calling `dogShop.get(true)` would return whatever the
underlying `catShop` returns — a `Cat` — while the caller's type system
promised a `Dog`. The "EVIL CAT!" comment is the punchline: you'd get a
`Cat` where a `Dog` was guaranteed. Return-type position is a *covariant*
position, and contravariant type parameters are barred from covariant
positions, so `PetShop[-T]` cannot declare `def get(...): T`.

**The escape hatch — widening/narrowing with a bounded extra type
parameter.** Both `MyList` and `PetShop` show the real-world fix: instead
of using `T` directly in the forbidden position, introduce a *fresh* type
parameter bounded relative to `T`.

```scala
class MyList[+A] {
  def add[B >: A](element: B): MyList[B] = new MyList[B] // widening the type
}

val emptyList = new MyList[Kitty]
val animals = emptyList.add(new Kitty)
val moreAnimals = animals.add(new Cat)
val evenMoreAnimals = moreAnimals.add(new Dog)
```
(lines 68–75)

`add` doesn't take an `A` — it takes a `B` that's a *supertype* of `A`
(`B >: A`), and returns `MyList[B]`. `B` is unconstrained by the class's
own variance, so it's legal in parameter position, and each `.add` call
lets the compiler infer a wider and wider `B` (`Kitty` → `Cat` → `Animal`)
as needed. This is exactly how immutable `List#::`/`+:` work in the real
standard library.

```scala
class PetShop[-T] {
  def get[S <: T](isItaPuppy: Boolean, defaultAnimal: S): S = defaultAnimal
}

val shop: PetShop[Dog] = new PetShop[Animal]
class TerraNova extends Dog
val bigFurry = shop.get(true, new TerraNova)
```
(lines 91–97)

Symmetrically, `get` introduces `S <: T` (a *subtype* of `T`) and returns
`S`, not `T` — so the return type is never literally the contravariant
parameter, and the compiler is satisfied. Note it also needs an actual
value of type `S` supplied by the caller (`defaultAnimal: S`) since there's
no other way to conjure a `T`-or-narrower value safely.

## 5. Rule of thumb: collections vs. actions

```scala
/*
  Rule of thumb
  - use covariance = COLLECTION OF THINGS
  - use contravariance = GROUP OF ACTIONS
 */
```
(lines 147–151)

The `IParking`/`CParking`/`XParking` block (lines 105–163) works through
this on a `Parking[T](vehicles: List[T])` API with `park`, `impound`,
`checkVehicles`, and `flatMap`. The pattern that falls out:
- If `T` is a *thing being stored* (a vehicle in a list), covariance is
  natural — `CParking[+T]` — but every method that would otherwise take a
  bare `T` as a parameter (`park`, `impound`) needs the `S >: T` widening
  trick from section 4.
- If `T` describes *what the type can act on/consume* (contravariant,
  `XParking[-T]`), parameters can take `T` directly, but anything that
  would return `T` (`checkVehicles`) needs the `S <: T` narrowing trick,
  and anything else parameterized by `T` used *inside* a parameter type
  (like `CList[R]` in `impound[R <: T](vehicles: CList[R])`) needs the same
  bound treatment, because `CList[T]`'s own `T` sits in a contravariant
  slot relative to the outer method.

## Key takeaway

Variance is a promise about substitutability that you write once (`+T`,
`-T`, or nothing) and the compiler enforces forever after via the
**variance positions rule**: method parameters are contravariant
positions, method return types are covariant positions, and a type
parameter's own variance annotation must be compatible with every position
it appears in. Covariant (`+T`) parameters are barred from parameter
positions; contravariant (`-T`) parameters are barred from return-type
positions; mutable fields need both a getter and setter and so force
invariance. When you hit that wall, the fix is almost never "remove the
variance annotation" — it's to introduce a fresh, bounded type parameter
(`B >: A` to widen, `S <: T` to narrow) on the offending method so the
class-level type parameter never appears directly where it isn't allowed.

---

## Exercises

1. Declare `class ReadOnlyBox[+T](contents: T) { def get: T = contents }`
   and confirm `val b: ReadOnlyBox[Animal] = new ReadOnlyBox[Cat](new Cat)`
   compiles. Then try adding `def set(value: T): Unit = ???` to the same
   class and explain (in a comment) exactly which compiler error you get
   and why, tying it back to the variance-positions rule.
2. Model a tiny event-handler hierarchy: `trait Handler[-E] { def handle(e: E): Unit }`
   with `class Event`, `class ClickEvent extends Event`. Show that a
   `Handler[Event]` can be assigned to a `Handler[ClickEvent]`-typed val,
   and explain in your own words why that direction is safe (tie it to the
   `AnotherContravariantCage` example in the lesson).
3. (Harder) Take the `PetShop[-T]` widening/narrowing trick from section 4
   and write your own `class Vault[-T] { def deposit(item: T): Unit = ()
   ; def withdraw[S <: T](preferred: S): S = preferred }`. Then try writing
   a version of `withdraw` that returns plain `T` instead of `S`, confirm
   it fails to compile, and write down the "EVIL CAT!"-style unsound
   scenario that would result if the compiler let it through.
