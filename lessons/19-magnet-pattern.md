# Lesson 19 — Magnet Pattern

Source: `src/lectures/part4implicits/MagnetPattern.scala`

This lesson assumes you're comfortable with implicit classes and type classes
(Lessons 12–17). The magnet pattern is what you get when you point implicits
at Scala's method-overloading machinery: instead of writing several
overloaded `def`s, you write **one** method that takes an implicit "magnet"
trait, and let implicit conversions do the work of picking the right
behavior for each argument type.

## The problem: overloading doesn't scale (lines 11–39)

```scala
trait Actor {
  def receive(statusCode: Int): Int
  def receive(request: P2PRequest): Int
  def receive(response: P2PResponse): Int
  def receive[T : Serializer](message: T): Int
  def receive[T : Serializer](message: T, statusCode: Int): Int
  def receive(future: Future[P2PRequest]): Int
  //    def receive(future: Future[P2PResponse]): Int
  // lots of overloads
}
```
This looks like ordinary, sane API design — one `receive` name, many argument
shapes. The comment block right after it (lines 29–39) lists why it actually
breaks down in practice:

1. **Type erasure.** `Future[P2PRequest]` and `Future[P2PResponse]` both
   erase to `Future` on the JVM. The commented-out line 25,
   `def receive(future: Future[P2PResponse]): Int`, cannot coexist with line
   24's `Future[P2PRequest]` overload — same erased signature, so it's a
   duplicate-method compile error. Overloading by generic type parameter
   alone doesn't work once erasure strips the type argument.
2. **Eta-expansion (lifting) doesn't work for all overloads.** `val
   receiveFV = receive _` (the commented line 33, and again at 104) fails to
   compile: the compiler can't decide *which* overload you meant to turn
   into a function value, because there's no argument context to
   disambiguate against.
3. **Code duplication.** Six overloads of `receive` likely share plumbing
   (logging, dispatch, error handling) that gets copy-pasted six times.
4. **Type inference + default args interact badly with overloading.**
   `actor.receive(?!)` — if some overloads have default parameters, or the
   argument is a lambda whose parameter types need to be inferred, the
   compiler can get stuck picking which overload applies *before* it even
   knows enough to disambiguate.

Overloading is the tool everyone reaches for first, and it's the one that
breaks hardest under type erasure and inference pressure.

## The fix: one method, an implicit "magnet" trait (lines 41–64)

```scala
trait MessageMagnet[Result] {
  def apply(): Result
}

def receive[R](magnet: MessageMagnet[R]): R = magnet()

implicit class FromP2PRequest(request: P2PRequest) extends MessageMagnet[Int] {
  def apply(): Int = {
    println("Handling P2P request")
    42
  }
}

implicit class FromP2PResponse(response: P2PResponse) extends MessageMagnet[Int] {
  def apply(): Int = {
    println("Handling P2P response")
    24
  }
}

receive(new P2PRequest)
receive(new P2PResponse)
```
There is now exactly **one** `receive` method — it's not overloaded at all.
It takes a single argument of type `MessageMagnet[R]`, an implicit-class
wrapper ("magnet") whose only job is to know how to produce a `Result` when
called with no arguments.

The dispatch that used to happen via overload resolution now happens via
**implicit conversion selection**: when you write `receive(new P2PRequest)`,
the compiler sees that `P2PRequest` isn't a `MessageMagnet[R]`, looks for an
implicit conversion into one, finds `FromP2PRequest`, and wraps the request
in it automatically. `receive(new P2PResponse)` triggers `FromP2PResponse`
instead. Each case's actual behavior — the `apply()` body — lives inside its
own magnet class, so the "overloads" simply become separate implicit
classes instead of separate method signatures.

### Why this dodges type erasure (lines 66–76)

```scala
implicit class FromResponseFuture(future: Future[P2PResponse]) extends MessageMagnet[Int] {
  override def apply(): Int = 2
}

implicit class FromRequestFuture(future: Future[P2PRequest]) extends MessageMagnet[Int] {
  override def apply(): Int = 3
}

println(receive(Future(new P2PRequest)))
println(receive(Future(new P2PResponse)))
```
This is the case that was flatly impossible with plain overloading (the
commented-out line 25). `FromResponseFuture` and `FromRequestFuture` both
take a `Future[_]` parameter — after erasure their *constructors* look
identical too — but that's fine, because they aren't overloads of the same
method name. They're two distinct classes with two distinct implicit
conversions. The compiler picks the conversion using the *unerased*,
statically-known type of the argument at the call site (`Future[P2PRequest]`
vs. `Future[P2PResponse]`), before erasure ever gets a say. There's nothing
left to clash on the JVM, because there's only ever one method
(`receive(magnet: MessageMagnet[R])`) being compiled.

### Why lifting (`_`) works again (lines 78–102)

```scala
trait AddMagnet {
  def apply(): Int
}

def add1(magnet: AddMagnet): Int = magnet()

implicit class AddInt(x: Int) extends AddMagnet {
  override def apply(): Int = x + 1
}

implicit class AddString(s: String) extends AddMagnet {
  override def apply(): Int = s.toInt + 1
}

val addFV = add1 _
println(addFV(1))
println(addFV("3"))
```
Compare this to the commented-out `receiveFV = receive _` from line 104,
which still fails for the *overloaded* `receive`. `add1 _` succeeds because
`add1` is not overloaded — it's a single method with a single parameter type
(`AddMagnet`), so eta-expansion has nothing to disambiguate. `addFV(1)` and
`addFV("3")` both type-check against the same lifted function value; the
implicit conversions to `AddInt`/`AddString` kick in at each call site as
usual. Magnetizing doesn't just fix erasure — it restores the ordinary,
non-overloaded behavior of the method everywhere overloading used to get in
the way.

**Gotcha:** the magnet method itself must stay non-overloaded for any of
this to pay off. If you write two overloads that both take *different*
magnet traits, you're back to square one — the whole point is collapsing
many signatures into one.

## The tradeoffs (lines 107–147)

The lecture is explicit that this isn't free — right after the pattern pays
off, the comment block (lines 108–114) lists the costs:

1. **Verbose.** Every "overload" you used to write as one line is now a
   separate `implicit class` with its own `apply()` body.
2. **Harder to read.** Someone unfamiliar with the pattern sees `receive`
   taking a mysterious `MessageMagnet[R]` and has to go hunt down every
   implicit class to know what call shapes are even supported — there's no
   single place listing "the overloads" anymore.
3. **You can't name or place default arguments** the way you can with real
   overloaded parameter lists, because everything funnels through one
   generic `apply()` signature.
4. **Call-by-name breaks in a way that's easy to miss.** Look at the last
   example:

```scala
class Handler {
  def handle(s: => String) = {
    println(s)
    println(s)
  }
}

trait HandleMagnet {
  def apply(): Unit
}

def handle(magnet: HandleMagnet) = magnet()

implicit class StringHandle(s: => String) extends HandleMagnet {
  override def apply(): Unit = {
    println(s)
    println(s)
  }
}

def sideEffectMethod(): String = {
  println("Hello, Scala")
  "hahaha"
}

//  handle(sideEffectMethod())
handle {
  println("Hello, Scala")
  new StringHandle("magnet")
}
```
`Handler.handle` takes its argument **by name** (`s: => String`), so calling
it with `sideEffectMethod()` would re-run the side effect (the `println`)
every time `s` is evaluated inside the body — twice, once per `println(s)`.
The magnetized version's implicit conversion, `StringHandle(s: => String)`,
*also* takes its constructor parameter by name — but the conversion itself
only runs **once**, at the moment `new StringHandle(...)` is constructed
implicitly from the raw string argument. The commented-out line
`handle(sideEffectMethod())` doesn't even compile cleanly for this reason
(the lecture disables it), and the working call is written manually as `new
StringHandle("magnet")` wrapped in a block, precisely to dodge the mismatch.
The takeaway: magnetizing a by-name parameter does not reproduce by-name
*call semantics* — the implicit conversion collapses repeated evaluation
into a single conversion-time evaluation. If your original overload relied
on re-evaluating a by-name argument on every use, the magnet pattern will
silently change that behavior.

## Key takeaway

The magnet pattern trades literal method overloading for a single method
plus a family of implicit conversions into a common marker trait. That
buys you dispatch that survives type erasure (each "overload" is its own
class, not a same-signature method) and restores clean eta-expansion
(`method _`), since there's only one real method to lift. In exchange you
give up some of what overloading gave you for free: named/default
arguments per case, easy readability/discoverability of "what forms can I
call this with," and faithful by-name call semantics. Reach for it when
erasure or lifting is actively blocking you — not as a default replacement
for ordinary overloading.

---

## Exercises

1. Add a `receive(x: Double): Int` case to the `MessageMagnet` example (an
   implicit class `FromDouble` wrapping a `Double`). Confirm `receive(3.14)`
   dispatches correctly, and explain in a comment why this could *not* have
   been added as a plain `def receive(x: Double): Int` overload alongside
   the existing `receive[T : Serializer](message: T): Int` generic overload
   for some choices of `T`.
2. Take the `AddMagnet` example and add a third case, `AddBoolean`, so that
   `add1(true)` returns `2` and `add1(false)` returns `1`. Then write
   `val addFV = add1 _` and call `addFV(true)`, confirming lifting still
   works with three magnetized cases.
3. (Harder — the call-by-name gotcha) Write a magnetized version of a
   `def repeat(s: => String, times: Int): Unit` that prints `s` `times`
   times. Demonstrate, using a `sideEffectMethod()` similar to the one in
   the source file, that calling your magnetized `repeat` with a
   side-effecting argument evaluates the side effect a different number of
   times than the original by-name `repeat` would. Explain why in a
   comment.
