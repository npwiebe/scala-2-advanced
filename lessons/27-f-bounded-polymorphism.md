# Lesson 27 — F-Bounded Polymorphism

Source: `src/lectures/part5ts/FBoundedPolymorphism.scala`

This lesson assumes you're comfortable with variance (Lesson 26). The problem
it solves shows up constantly in ORMs, builder APIs, and "self-referencing"
domain models: a method defined in a supertype needs to return **the caller's
specific subtype**, not the supertype itself. The file works through five
attempts, each fixing the previous one's flaw, so we'll walk them in order.

## 1. The problem (lines 8–18, commented out)

```scala
trait Animal {
  def breed: List[Animal]
}

class Cat extends Animal {
  override def breed: List[Animal] = ??? // List[Cat] !!
}

class Dog extends Animal {
  override def breed: List[Animal] = ??? // List[Dog] !!
}
```
`breed` is declared once in `Animal` and inherited by `Cat` and `Dog`. But a
`Cat` obviously breeds more `Cat`s, not arbitrary `Animal`s — a `Dog` could
sneak into the returned list and the type system wouldn't object. The
*supertype's* method signature is too weak to express "returns more of my own
specific type." This is the core F-bounded polymorphism problem: how do you
let a supertype method return the *calling subtype*, checked at compile time?

## 2. Naive fix: override the return type (lines 20–32, commented out)

```scala
class Cat extends Animal {
  override def breed: List[Cat] = ??? // List[Cat] !!
}

class Dog extends Animal {
  override def breed: List[Cat] = ??? // List[Dog] !!
}
```
Since `List` is covariant and `Cat`/`Dog` are subtypes of `Animal`, Scala
*does* let you narrow the override's return type — that's legal variance.
But nothing forces you to narrow it *correctly*. Notice the bug baked into
the snippet: `Dog`'s override also says `List[Cat]`, and the compiler happily
accepts it — `List[Cat] <: List[Animal]` is exactly as valid as `List[Dog] <:
List[Animal]`. Manually copy-pasting the "right" return type into every
subclass is error-prone and has zero compiler backing. We need the supertype
itself to *guarantee* the relationship between "my subtype" and "what I
return."

## 3. F-Bounded Polymorphism (lines 35–56, commented out)

```scala
trait Animal[A <: Animal[A]] { // recursive type: F-Bounded Polymorphism
  def breed: List[Animal[A]]
}

class Cat extends Animal[Cat] {
  override def breed: List[Animal[Cat]] = ??? // List[Cat] !!
}

class Dog extends Animal[Dog] {
  override def breed: List[Animal[Dog]] = ??? // List[Dog] !!
}
```
`trait Animal[A <: Animal[A]]` is a type bounded by a type expression that
mentions itself — an **F-bounded type**. Read the bound as: "`A` must be a
subtype of `Animal[A]`," i.e. `A` has to be an animal-of-itself. `Cat extends
Animal[Cat]` satisfies that (`Cat <: Animal[Cat]`), and now `breed`'s return
type, `List[Animal[A]]`, is parameterized on the concrete `A` each subclass
supplies — so `Cat`'s `breed` really is pinned to `Animal[Cat]` by the
supertype's own declaration, not by a hand-copied override.

This is a common enough pattern that it shows up under other names too — an
ORM base type might write `trait Entity[E <: Entity[E]]`, and Java's
`Comparable[T]` is used the same way: `class Person extends
Comparable[Person]`.

**Gotcha:** F-bounding constrains what `A` can be, but it doesn't constrain
what `A` has to be *relative to the class using it*. Nothing stops you from
plugging in the *wrong* type parameter:

```scala
class Crocodile extends Animal[Dog] {
  override def breed: List[Animal[Dog]] = ??? // List[Dog] !!
}
```
This compiles cleanly — `Dog <: Animal[Dog]` is true, so `Dog` satisfies the
bound, and `Crocodile` is perfectly free to extend `Animal[Dog]` instead of
`Animal[Crocodile]`. The type system enforces the *shape* of the recursion,
not that a class parameterizes `Animal` with *itself*.

## 4. F-Bounded Polymorphism + self-types (lines 58–83, commented out)

```scala
trait Animal[A <: Animal[A]] { self: A =>
  def breed: List[Animal[A]]
}

class Cat extends Animal[Cat] {
  override def breed: List[Animal[Cat]] = ??? // List[Cat] !!
}
```
Adding the self-type `{ self: A => }` tells the compiler: "whoever mixes in
`Animal[A]` must also *be* an `A`." Now `class Crocodile extends
Animal[Dog]` fails to compile — `Crocodile` would have to be a `Dog`, which
it isn't. The self-type is what actually closes the loophole from step 3: it
forces the class extending `Animal[A]` to line up with the `A` it names.

**Gotcha:** even this isn't airtight once inheritance hierarchies get
deeper. The file's own example:

```scala
trait Fish extends Animal[Fish]
class Shark extends Fish {
  override def breed: List[Animal[Fish]] = List(new Cod) // wrong
}

class Cod extends Fish {
  override def breed: List[Animal[Fish]] = ???
}
```
`Fish` satisfies `self: Fish =>` for itself, and both `Shark` and `Cod`
extend `Fish` (not `Animal[Shark]` / `Animal[Cod]` directly), so they both
inherit `Animal[Fish]`. That means `Shark.breed` is typed to return
`List[Animal[Fish]]` — and a `Cod` *is* an `Animal[Fish]`, so `List(new
Cod)` type-checks even though a shark breeding a cod is exactly the bug we
set out to prevent. F-bounding plus self-types constrains one class's direct
relationship to its type parameter, but it can't stop an *intermediate*
trait from blurring "my specific type" back into a shared family type. The
mechanism is also just syntactically heavy: every domain trait needs the
recursive bound *and* a self-type annotation to get partial safety.

## 5. The type-classes alternative (lines 87–152)

The file's own comment above this section literally reads `// Exercise` —
it's presented as "try solving this a different way," and the answer is to
stop trying to make inheritance self-referential at all. Instead, describe
"breeding" as a capability attached to a type from the *outside*:

```scala
trait Animal[A] { // pure type classes
  def breed(a: A): List[A]
}

class Dog
object Dog {
  implicit object DogAnimal extends Animal[Dog] {
    override def breed(a: Dog): List[Dog] = List()
  }
}

implicit class AnimalOps[A](animal: A) {
  def breed(implicit animalTypeClassInstance: Animal[A]): List[A] =
    animalTypeClassInstance.breed(animal)
}

val dog = new Dog
dog.breed
```
`Animal[A]` is no longer a trait `Dog`/`Cat` extend — `Dog` is now a plain,
unrelated class. `Animal[Dog]` is a separate *type class instance* living in
`Dog`'s companion object, declared `implicit` so the compiler can find it.
The `AnimalOps` implicit class adds a `.breed` extension method to *any* `A`,
as long as an `Animal[A]` instance is in implicit scope — this is the same
implicit-conversion mechanism from earlier lessons, just applied to attach
"breed" behavior polymorphically. `dog.breed` desugars to
`new AnimalOps(dog).breed(Dog.DogAnimal)`, and the return type is `List[Dog]`
with zero self-types, zero recursive bounds, and zero risk of a `Crocodile
extends Animal[Dog]`-style mismatch — there's no inheritance relationship to
abuse in the first place.

This buys real advantages over F-bounded polymorphism:
- **No self-type gymnastics.** The subtype-of-itself puzzle disappears
  because nothing is self-referencing — `Animal[A]` is just an ordinary
  generic trait.
- **Works with types you don't own.** You can write `Animal[String]` or
  `Animal[SomeLibraryClass]` without touching that type's inheritance
  hierarchy at all — impossible with F-bounding, which requires the type
  itself to `extends Animal[ThatType]`.
- **Mismatches surface as missing implicits, not silently-accepted bugs.**
  Look closely at the file's `Cat` companion (lines 136–141):
  ```scala
  class Cat
  object Cat {
    implicit object CatAnimal extends Animal[Dog] {
      override def breed(a: Dog): List[Dog] = List()
    }
  }
  ```
  That's a typo — `CatAnimal` was meant to be an `Animal[Cat]` but was
  written as `Animal[Dog]`. With F-bounded polymorphism this class of typo
  (`Crocodile extends Animal[Dog]`) compiled and produced wrong runtime
  behavior. Here, it doesn't even get that far: `val cat = new Cat;
  cat.breed` (lines 151–152) is commented out in the source because it
  **fails to compile** — the compiler looks for an implicit `Animal[Cat]`,
  finds none (only `Animal[Dog]` instances exist), and reports "could not
  find implicit value." The bug becomes a compile error at the call site
  instead of a silently-accepted wrong type.

**Gotcha:** type classes trade the "everything lives on the class itself"
directness of F-bounded polymorphism for indirection through implicit
resolution. You gain safety and flexibility, but debugging "why isn't my
`.breed` call found" now means reasoning about implicit scope rather than
reading a straightforward inheritance chain.

## Key takeaway

"Return the more specific subtype from a supertype-defined method" cannot be
solved by narrowing an override's return type by hand (step 2) — nothing
checks it. F-bounded polymorphism (`trait Animal[A <: Animal[A]]`) lets the
supertype's signature reference "whatever concrete subtype extends me," but
by itself it only constrains the *shape* of `A`, not that a given class's
`A` matches itself — self-types (`{ self: A => }`) close most of that gap by
forcing the class to *be* its own type parameter, though even that can be
routed around through an intermediate trait. In practice, the type-classes
pattern is usually the better tool for this exact problem: it sidesteps
self-referencing inheritance entirely, works on types you don't control, and
turns type mismatches into compile errors (missing implicits) instead of
runtime surprises.

---

## Exercises

1. Take the naive version from section 1 (`trait Animal { def breed: List[Animal] }`
   with `Cat`/`Dog`). Convert it to F-bounded polymorphism as in section 3,
   then deliberately write a third class, `Fox extends Animal[Cat]`, and
   confirm it compiles. Add the self-type `{ self: A => }` to `Animal[A]`
   and confirm `Fox` now fails to compile with a self-type error.
2. Using the type-classes pattern from section 5, define a `Feed[A]` type
   class with `def feed(a: A): A` (feeding an animal returns it, presumably
   fatter). Give `Dog` and `Cat` each a correct implicit `Feed` instance in
   their companion objects, add a `FeedOps` implicit class exposing `.feed`,
   and confirm `new Dog().feed` and `new Cat().feed` both work.
3. (Harder) Reproduce the `Fish`/`Shark`/`Cod` loophole from section 4
   yourself: define `trait Fish extends Animal[Fish]` (with the self-typed
   `Animal[A]` from section 4), then `class Shark extends Fish` and `class
   Cod extends Fish`. Write `Shark`'s `breed` to return a `List` containing a
   `Cod`, and confirm the compiler accepts it — then explain in a comment
   why the self-type didn't catch this one.
