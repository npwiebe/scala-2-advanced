# Lesson 25 — Type Members

Source: `src/lectures/part5ts/TypeMembers.scala`

This lesson is closely related to Lesson 24 (Path-Dependent Types) — that
lesson explains how a type nested inside an instance becomes tied to that
specific instance's path (`instance.Type`). This lesson focuses on the other
half of the picture: *declaring* those types abstractly inside a trait/class,
and treating them as a genuine alternative to generic type parameters.
(If Lesson 24's file doesn't exist yet in this repo, the path-dependent-types
mechanics are only touched on briefly here — go deeper there.)

## 1. Abstract type members

```scala
class AnimalCollection {
  type AnimalType // abstract type member
}

val ac = new AnimalCollection
val dog: ac.AnimalType = ???
```
`type AnimalType` (line 14) declares a type **member** of the class — a type
that lives inside the class body the same way a `val` or `def` would, rather
than being supplied as a generic parameter `[T]`. It has no definition here,
so it's abstract: nothing can be constructed as an `AnimalType` inside
`AnimalCollection` itself (there's no known concrete type to instantiate).
Outside, you can still refer to it path-dependently as `ac.AnimalType` (line
21) — it's a legitimate type, just one the compiler doesn't know the identity
of yet. That's why the `val dog: ac.AnimalType = ???` on line 21 typechecks:
it's a valid type annotation, we just can't actually produce a value of it
without more information.

## 2. Fixing the type in a concrete definition

```scala
class AnimalCollection {
  type AnimalC = Cat
}
val cat: ac.AnimalC = new Cat
```
`type AnimalC = Cat` (line 17) is a **type alias**, not an abstract member —
it fixes the type member to a concrete type right where it's declared. Once
fixed, `ac.AnimalC` simply *is* `Cat`, so `val cat: ac.AnimalC = new Cat`
compiles fine (line 26).

The more common pattern, though, is to leave the type abstract in a
trait/superclass and let *subclasses* fix it — the type-member equivalent of
overriding:

```scala
trait MyList {
  type T
  def add(element: T): MyList
}

class NonEmptyList(value: Int) extends MyList {
  override type T = Int
  def add(element: Int): MyList = ???
}
```
`MyList` (lines 32–35) declares `type T` abstractly and uses it in `add`'s
signature, exactly the way you'd use a generic parameter. `NonEmptyList`
(lines 37–40) then commits to a concrete type with `override type T = Int`,
and `add`'s parameter type narrows to `Int` accordingly. This is the "generics
vs. abstract type members" duality: `trait MyList[T]` with `class
NonEmptyList extends MyList[Int]` would express the *identical* idea using
type parameters instead.

## 3. Upper and lower bounds on type members

```scala
class AnimalCollection {
  type BoundedAnimal <: Animal
  type SuperBoundedAnimal >: Dog <: Animal
}

//  val cat: ac.BoundedAnimal = new Cat   // does NOT compile
val pup: ac.SuperBoundedAnimal = new Dog  // compiles
```
Just like a generic parameter can be constrained (`[T <: Animal]`), a type
member can carry the same bounds:
- `type BoundedAnimal <: Animal` (line 15) — an **upper bound**: whatever
  concrete type ends up filling `BoundedAnimal` must be `Animal` or a
  subtype of it.
- `type SuperBoundedAnimal >: Dog <: Animal` (line 16) — both a **lower
  bound** (`Dog` or a supertype of `Dog`) and an upper bound (`Animal` or a
  subtype) at once.

The bound restricts what a subclass is *allowed* to fix the type to, not
what the type currently is. `BoundedAnimal` on its own is never fixed to
anything in this file, so `new Cat` still fails against it (line 23 is
commented out because `Cat` isn't proven to be `BoundedAnimal` — the compiler
has no evidence, bound or not, that they're related) — but `new Dog` type-checks
against `SuperBoundedAnimal` because `Dog` sits inside the declared `Dog..Animal`
range (line 25).

**Gotcha:** a bound is a *constraint on what's legal*, not an assignment.
`type BoundedAnimal <: Animal` never becomes "usable" for constructing values
until something fixes it to an actual type (as `AnimalC = Cat` does). Bounds
alone just narrow the space of legal future overrides — the same role
`[T <: Animal]` plays for a generic parameter.

## 4. Enforcing bounds through mix-in traits (the exercise pattern)

```scala
trait MList {
  type A
  def head: A
  def tail: MList
}

trait ApplicableToNumbers {
  type A <: Number
}

// NOT OK — String is not a Number
// class CustomList(hd: String, tl: CustomList) extends MList with ApplicableToNumbers {
//   type A = String
//   ...
// }

// OK
class IntList(hd: Integer, tl: IntList) extends MList with ApplicableToNumbers {
  type A = Integer
  def head = hd
  def tail = tl
}
```
This is the file's closing exercise (lines 51–73), and it shows why type
members are useful beyond stylistic preference: `ApplicableToNumbers` is a
small trait whose *entire purpose* is to attach a bound (`type A <: Number`)
to whatever mixes it in. Because Scala merges type members from all
supertypes and requires every override to respect every inherited bound,
mixing `MList with ApplicableToNumbers` into `IntList` means its `type A = Integer`
must satisfy `<: Number` — which it does, since `Integer` is a `Number`. A
hypothetical `CustomList` fixing `type A = String` fails to compile, because
`String` isn't a `Number`. This gives you a way to retrofit a constraint onto
an existing abstract-type-member hierarchy *without* touching the original
trait — you can't do this after the fact with a generic parameter `[A]`,
since bounds on `[A]` have to be written at the original declaration site.

## 5. Generics vs. abstract type members — when to reach for which

Both `trait MyList[T]` and `trait MyList { type T }` parametrize a type. The
difference is *where the type gets chosen*:

- **Generic parameter (`[T]`)**: the type is chosen **at the call/construction
  site** — `new MyList[Int]`. The same class can be instantiated at many
  different types side by side in the same program (`MyList[Int]`,
  `MyList[String]`, ...).
- **Abstract type member (`type T`)**: the type is chosen **once, by whichever
  subclass/object fixes it** — it becomes part of that class's own identity,
  and (per Lesson 24) accessing it from outside requires going through a
  specific instance's path (`ac.AnimalType`), not a type applied at the use
  site.

Reach for a type member when:
- The "parametrized" type is really an intrinsic property of a particular
  subclass or instance, not something a caller should be free to plug in
  arbitrarily (`NonEmptyList` *is* an `Int`-list; that's not a choice made
  per call).
- You want to attach or retrofit a **bound** to a type via mix-in composition
  (`ApplicableToNumbers`), which isn't expressible by tweaking a `[T]`
  parameter after the trait is already defined.
- You're designing APIs where the type should vary "per path" (per instance)
  rather than be selected explicitly by every caller — this is the seed of
  path-dependent types (Lesson 24), where `ac.AnimalType` and
  `otherAc.AnimalType` are treated as different types by the compiler even
  though they came from the "same" abstract declaration.

Reach for a generic parameter when callers genuinely need to choose and mix
types freely at each use site — most everyday collection/utility code.

## Key takeaway

A `type T` inside a trait/class is a type member: an abstract type slot that
behaves like a field but holds a *type* instead of a value. It can be left
abstract, fixed with `type T = ConcreteType`, or constrained with upper/lower
bounds (`<:`, `>:`) the same way generic parameters can. Subclasses fix or
further-bound inherited type members the way they'd override a method, and
mixing in a trait that only exists to add a bound (`ApplicableToNumbers`) lets
you constrain a hierarchy without editing its original declaration. The core
trade-off versus generics: type members bind the type to the declaring
instance's path rather than to the caller's choice at each use — which is
exactly the mechanism Lesson 24 (Path-Dependent Types) builds on.

---

## Exercises

1. Write a trait `Container { type Item; def store(item: Item): Unit; def
   retrieve: Item }`, then write two subclasses — `StringContainer` fixing
   `type Item = String` and `IntContainer` fixing `type Item = Int`. Confirm
   you cannot pass an `Int` to `StringContainer.store`.
2. Add a trait `NumericOnly { type Item <: Number }` and mix it into a new
   `class BoxedDouble extends Container with NumericOnly { type Item = Double
   }` — wait, `Double` isn't a `Number` in the `java.lang` sense; fix it to
   use `java.lang.Double` instead and get it compiling. Then try (and
   confirm fails) fixing `Item` to `String` on a class that also mixes in
   `NumericOnly`.
3. Rewrite `MyList`/`NonEmptyList` from this lesson (section 2) as a
   generic `trait MyList[T] { def add(element: T): MyList[T] }` instead.
   Write a short paragraph comparing the two versions: which callers would
   notice a difference, and what do you lose or gain by switching?
