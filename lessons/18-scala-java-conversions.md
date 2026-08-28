# Lesson 18 — Scala/Java Conversions

Source: `src/lectures/part4implicits/ScalaJavaConversions.scala`

This lesson assumes you're comfortable with implicits from Lessons 12-14
(implicit classes, implicit conversions, implicit resolution). Everything
here is just another application of that machinery — there's no new
language feature, only a library (`scala.jdk.CollectionConverters`, formerly
`scala.collection.JavaConverters`) that ships a pile of implicit conversions
between the JVM's two parallel collection hierarchies.

## Why two hierarchies at all

Java and Scala each have their own collections API: `java.util.List`,
`java.util.Set`, `java.util.Map` on one side; Scala's `List`, `Set`, `Map`
on the other. They aren't related by inheritance — Scala collections are
(mostly) immutable and richer in API (`map`, `filter`, `fold`, etc.), while
Java's are mutable-by-default and predate Scala entirely. Since Scala runs
on the JVM and constantly has to interoperate with Java libraries (think
`java.util.HashMap`-based APIs, or old Java frameworks), you need a bridge
whenever a Java API hands you a `ju.List` but the rest of your Scala code
wants to treat it like a Scala `Seq`, or vice versa.

```scala
import java.{util => ju}

val javaSet: ju.Set[Int] = new ju.HashSet[Int]()
(1 to 5).foreach(javaSet.add)
```
Line 3 and 13-14: this is a plain Java `HashSet`, built and populated using
its native Java API (`.add`, mutable). Nothing Scala-specific about it yet.

## The bridge: `.asScala` and `.asJava`

```scala
import collection.JavaConverters._      // older API (deprecated in 2.13+)
import scala.jdk.CollectionConverters._ // current API

val scalaSet = javaSet.asScala
```
Lines 9, 11, 17. Both imports bring a set of **implicit conversions** into
scope — exactly the pattern from Lesson 12: pimping an existing type
(`ju.Set[Int]`) with a method it doesn't natively have (`.asScala`) via an
implicit class/conversion. Once imported, `.asScala` and `.asJava` "just
appear" on the relevant collection types because the compiler silently
wraps your value in a converter object that has that method. `javaSet` is
still a `java.util.Set` at line 13 — no method named `asScala` exists on
it — but because the implicit is in scope, `javaSet.asScala` compiles by
having the compiler search for (and find) an implicit conversion from
`ju.Set[Int]` to something with an `asScala` method.

The library defines this symmetrically for the common pairs (comment at
lines 19-26 of the source lists them):

```
Iterator            <-> Iterator
Iterable             <-> Iterable
ju.List              <-> collection.mutable.Buffer
ju.Set               <-> collection.mutable.Set
ju.Map               <-> collection.mutable.Map
```
Notice the Scala side is always a **mutable** collection type when the
source is Java — that's not an accident, see the Gotcha below.

## It's the same conversion trick as Lesson 12 — nothing new under the hood

```scala
class ToScala[T](value: => T) {
  def asScala: T = value
}

implicit def asScalaOptional[T](o: ju.Optional[T]): ToScala[Option[T]] =
  new ToScala[Option[T]](
    if (o.isPresent) Some(o.get) else None
  )

val juOptional: ju.Optional[Int] = ju.Optional.of(2)
val scalaOption = juOptional.asScala
```
Lines 47-57. This is the whole trick laid bare, hand-rolled instead of
imported from the standard library: a wrapper class `ToScala[T]` holding a
lazily-computed `value` (note the `=> T` — call-by-name, so the
`Some`/`None` conversion isn't computed until `.asScala` is actually
called), plus an `implicit def` that the compiler inserts automatically
when it sees `.asScala` called on something it wouldn't otherwise have.
`scala.jdk.CollectionConverters` is doing exactly this, just for many more
types and with more careful (bidirectional, wrapper-based rather than
copying) implementations. If you understood implicit classes and implicit
conversions in Lesson 12, you already understand how `.asJava`/`.asScala`
work — this whole facility is a library, not a language feature.

## Gotcha: mutable Java collections stay linked through the view

```scala
import collection.mutable._
val numbersBuffer = ArrayBuffer[Int](1, 2, 3)
val juNumbersBuffer = numbersBuffer.asJava

println(juNumbersBuffer.asScala eq numbersBuffer) // true
```
Lines 28-32. Converting a **mutable** Scala collection to Java and back
gives you `eq` (reference) equality with the original — because
`asJava`/`asScala` on mutable collections don't copy anything; they
construct a lightweight *view* wrapping the same underlying data
structure. Mutating `juNumbersBuffer` through its Java API would mutate
`numbersBuffer` too, and mutating `numbersBuffer` would be visible through
`juNumbersBuffer`. This is essential to know before passing a Scala
mutable collection into a Java API that mutates it in place — the
mutation is *not* sandboxed away from your Scala code.

## Gotcha: immutable collections are copied, not views — and the Java side can't actually be mutated safely

```scala
val numbers = List(1,2,3)
val juNumbers = numbers.asJava
val backToScala = juNumbers.asScala
println(backToScala eq numbers)  // false
println(backToScala == numbers)  // true

//  juNumbers.add(7)
```
Lines 34-40. Here `numbers` is an **immutable** Scala `List`. Converting it
to `ju.List` and back gives a *new* object (`eq` is `false`) that is merely
`==`-equal (same elements) to the original — round-tripping through the
Java side does not preserve identity the way the mutable case did, because
there's no shared mutable backing store to hand out a view onto.

More importantly, the commented-out line 40 is a landmine left intentionally
in the source: `juNumbers` is presented as a `ju.List[Int]`, which
structurally supports `.add`, but the underlying implementation wraps an
**immutable** Scala `List`. Calling `.add(7)` on it throws
`UnsupportedOperationException` at runtime — the Java-shaped API doesn't
guarantee Java-shaped mutability semantics. Wrapping something as the "other
side's" type only changes what methods are visible to the compiler; it
doesn't change what operations are actually safe to perform underneath.

## Key takeaway

`.asJava` and `.asScala` are ordinary implicit conversions/classes — the
exact mechanism from Lesson 12 — supplied wholesale by
`scala.jdk.CollectionConverters` so you don't have to hand-write them for
every Java/Scala collection pair, the way the lesson does manually for
`ju.Optional` → `Option`. They make interop with Java libraries read
naturally, but they are not magic: converting a *mutable* Java/Scala
collection produces a live view sharing the same backing data (mutate one,
mutate both), while converting an *immutable* Scala collection produces a
fresh, disconnected Java-shaped copy that will blow up at runtime if you
try to mutate it. Always know which side of that line you're on before you
hand a converted collection to code that might write to it.

---

## Exercises

1. Reproduce the `ju.Optional` → `Option` conversion from lines 47-57
   yourself, then write the mirror-image `implicit class` (or `implicit
   def`) that adds `.asJava` to a Scala `Option[T]`, converting `Some(x)`
   to `ju.Optional.of(x)` and `None` to `ju.Optional.empty[T]()`. Confirm
   both directions round-trip.
2. Build a `java.util.HashMap[String, Int]`, populate it via its native
   Java API, then `.asScala` it into a Scala `mutable.Map`. Add an entry
   through the Scala map and print the original Java map to confirm the
   mutation is visible on both sides (same underlying-view behavior as
   the `ArrayBuffer` example on lines 28-32).
3. Take an immutable Scala `Set(1,2,3)`, convert it with `.asJava`, and
   write a small function that accepts a `ju.Set[Int]` and calls
   `.add(4)` on whatever is passed in. Run it against your converted set
   and observe/explain the exception, then run it against a genuinely
   mutable `new ju.HashSet[Int]()` and observe the difference.
