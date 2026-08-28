# Lesson 4 — Currying & Partially Applied Functions (PAF)

Source: `src/lectures/part2afp/CurriesPAF.scala`

You already know functions and methods look interchangeable in day-to-day
code — `list.map(f)` works whether `f` is a `val` or a `def`. This lesson
pulls that apart: functions and methods are genuinely different things on
the JVM, curried methods let you build functions "one argument at a time,"
and the compiler's ETA-expansion is the glue that lets a method masquerade
as a function value whenever you need one.

## 1. A curried *function* value

```scala
val superAdder: Int => Int => Int =
  x => y => x + y

val add3 = superAdder(3)   // Int => Int = y => 3 + y
println(add3(5))           // 8
println(superAdder(3)(5))  // 8, curried function
```
(lines 9–14) `superAdder` isn't `(Int, Int) => Int`; its type is
`Int => (Int => Int)` — a function that takes an `Int` and *returns another
function*. Calling `superAdder(3)` doesn't add anything yet; it just returns
the inner lambda `y => 3 + y` with `x` baked in as `3`. `superAdder(3)(5)` is
really two separate function applications chained together. This is
currying: instead of one function of two arguments, you have a function of
one argument that produces a function of the next argument.

## 2. A curried *method* — multiple parameter lists

```scala
def curriedAdder(x: Int)(y: Int): Int = x + y // curried method

val add4: Int => Int = curriedAdder(4)
// lifting = ETA-EXPANSION
```
(lines 17–20) `curriedAdder` is a **method** (`def`), not a function value,
but it's declared with two parameter lists instead of one tuple of two
params. Methods and functions are different beasts on the JVM — a method
lives on a class/object and is invoked by name, while a function value is an
actual object (an instance of `Function1`, `Function2`, etc., under the
hood — recall this connects to the SAM-conversion mechanics from Lesson 1).
`curriedAdder(4)` on its own isn't valid as a method call (`Int` isn't the
full argument list), so when you write `val add4: Int => Int =
curriedAdder(4)`, the compiler needs to hand you back an actual `Function1`
object. It does that automatically — that conversion is called
**ETA-expansion**, and it's triggered here purely because the target type
annotation (`Int => Int`) told the compiler you wanted a function value, not
a method call.

## 3. ETA-expansion happens more often than you'd notice

```scala
def inc(x: Int) = x + 1
List(1,2,3).map(x => inc(x))  // ETA-expansion

...
println(numbers.map(curriedFormatter("%14.12f"))) // compiler does sweet eta-expansion for us
```
(lines 23–24, 67) Any time a method is used where a function value is
expected — passed as an argument to `map`, assigned to a `val` with a
function type, etc. — Scala silently rewrites `inc` into `x => inc(x)` for
you. You could even write `List(1,2,3).map(inc)` directly (no explicit
underscore needed) and the compiler would still ETA-expand it, because
`map`'s parameter type (`A => B`) makes the target obvious. This is *why*
you can pass `def`s around as if they were lambdas everywhere in Scala,
even though under the hood a method call and a function object are
different things.

## 4. Partially Applied Functions (PAF): the `_` lift

```scala
val add5 = curriedAdder(5) _ // Int => Int
```
(line 27) Here there's no target type telling the compiler you want a
function value — `add5` has no annotation. Trailing `_` after a method call
with some arguments supplied is the explicit way to say "stop here, don't
finish evaluating; give me back a function value for the remaining
parameter list(s)." This is a **Partially Applied Function**: you've fixed
`x = 5` and are leaving `y` open. Under the hood it's ETA-expansion again,
just requested explicitly instead of inferred from context.

Gotcha: `curriedAdder(5) _` and `curriedAdder(5)` mean different things
depending on context. Without a function-typed target (a `val` type
annotation, or a parameter slot expecting `A => B`), `curriedAdder(5)` alone
won't compile — Scala won't guess you want a lift. The `_` (or an
explicit target type as in §2) is what tells it so.

## 5. Six ways to build `add7` — and which is most idiomatic

```scala
val simpleAddFunction = (x: Int, y: Int) => x + y
def simpleAddMethod(x: Int, y: Int) = x + y
def curriedAddMethod(x: Int)(y: Int) = x + y

// IDIOMATIC — use underscore PAF:
val add7_best = simpleAddFunction(7, _: Int)    // PREFERRED
val add7_best2 = curriedAddMethod(7) _          // PREFERRED for curried methods

// ACCEPTABLE but more verbose:
val add7_manual = (x: Int) => simpleAddFunction(7, x)  // manual lambda wrapping

// LESS COMMON (but still valid):
val add7_curried = simpleAddFunction.curried(7)
val add7_paren = curriedAddMethod(7)(_)  // alternative PAF syntax (same as add7_best2)
```
(lines 30–45) All produce the same `Int => Int`, but the **idiomatic Scala approach
is to use the underscore `_` placeholder** — it's concise and reads like "this slot
stays open." Here's what each does:

- **`simpleAddFunction(7, _: Int)`** — **MOST IDIOMATIC**: The `_` says "build me
  a function that takes an `Int` here." The type `: Int` disambiguates which slot.
  Works for any multi-arg function or method.
- **`curriedAddMethod(7) _`** — **MOST IDIOMATIC for curried methods**: Trailing
  `_` after a partially-applied curried method. Clearest signal of intent.
- **`(x: Int) => simpleAddFunction(7, x)`** — Manual lambda wrapping. Only use this
  when you need to customize behavior (e.g., logging, validation). Don't do this
  just to create a PAF — the `_` is cleaner.
- **`simpleAddFunction.curried(7)`** — Less common. Only reach for this if you're
  already working with `.curried` conversions; the `_` syntax is usually preferred.
- **`curriedAddMethod(7)(_)`** — Alternative syntax, same as `curriedAddMethod(7) _`.
  Personal preference which you write, but trailing `_` is more common.

Key takeaway: **PAF is one general trick — use `_` to mark "leave this
argument slot open" — that applies whether you're partially filling a
regular multi-arg method/function or finishing off a curried method's
second parameter list.** Currying (multiple parameter lists) and partial
application (`_` placeholders) are different features that compose well
together.

## 6. Underscores can mark more than one open slot

```scala
def concatenator(a: String, b: String, c: String) = a + b + c
val insertName = concatenator("Hello, I'm ", _: String, ", how are you?")
// x: String => concatenator("Hello, I'm ", x, ", how are you?")
println(insertName("Daniel"))

val fillInTheBlanks = concatenator("Hello, ", _: String, _: String)
// (x, y) => concatenator("Hello, ", x, y)
println(fillInTheBlanks("Daniel", " Scala is awesome!"))
```
(lines 48–53) `_` isn't limited to one placeholder or to trailing position.
Each `_` becomes one parameter of the resulting function value, filled in
left to right in the order they appear in the argument list. `insertName`
becomes a 1-argument function (one open slot in the middle); `fillInTheBlanks`
becomes a 2-argument function (two open slots). This is genuinely useful for
building small DSL-ish helper functions out of a general-purpose method
without writing out `(x, y) => concatenator(...)` by hand.

## 7. Why this matters: building control-structure-like DSLs

The formatter exercise makes the payoff concrete:

```scala
def curriedFormatter(s: String)(number: Double): String = s.format(number)
val numbers = List(Math.PI, Math.E, 1, 9.8, 1.3e-12)

val simpleFormat = curriedFormatter("%4.2f") _   // lift
val seriousFormat = curriedFormatter("%8.6f") _
val preciseFormat = curriedFormatter("%14.12f") _

println(numbers.map(curriedFormatter("%14.12f"))) // eta-expansion, no `_` needed
```
(lines 60–67) By splitting the format string into its own parameter list,
`curriedFormatter("%4.2f")` reads like you're *configuring* a formatter,
and the result is a reusable `Double => String` you can pass straight into
`.map`. This is the same shape that lets library authors write things like
`Future { ... }`, `Try { ... }`, or custom retry/timing helpers that *look*
like built-in control structures (recall the single-argument-block sugar
from Lesson 1) — currying plus PAF/ETA-expansion is how you get a
config-then-execute two-step API without the caller ever writing an
explicit lambda.

## 8. By-name parameters (`=> T`) vs. zero-argument function parameters (`() => T`)

**By-name** and **by-function** are fundamentally different, even though they look
similar. Understanding the distinction is crucial for writing correct Scala.

### The types and signatures

```scala
def byName(n: => Int): Int = n + n          // by-name: re-evaluates each use
def byFunction(f: () => Int): Int = f() + f()  // by-function: you call it
```

- **By-name `n: => Int`**: NOT a function. It's deferred/lazy evaluation of an
  expression. **Each time** you reference `n` in the body, the expression is
  re-evaluated.
- **By-function `f: () => T`**: A real `Function0` (zero-argument function). You
  must call it with `f()` to run it. Each `f()` call re-runs the function body.

### The practical difference

```scala
def test1(x: => Int): Unit = {
  println(x)  // evaluates the argument HERE
  println(x)  // evaluates the argument AGAIN — runs twice!
}

def test2(f: () => Int): Unit = {
  println(f())  // YOU call it, it runs once
  println(f())  // YOU call it again, it runs once more
}

// Calling them:
test1({ println("computing"); 42 })
// Output: computing   / 42 / computing / 42

test2(() => { println("computing"); 42 })
// Output: computing / 42 / computing / 42
```

Both re-evaluate (or re-run) twice, but for different reasons: by-name re-evaluates
the expression each time it's mentioned; by-function re-runs the lambda each time
you call `f()`.

### Call-site compatibility — the gotchas

```scala
def method: Int = 42           // no parens
def parenMethod(): Int = 42    // has parens

// BY-NAME accepts almost anything — it's just an expression:
byName(23)                   // ✅ a literal
byName(method)               // ✅ expression: call the method (evaluated lazily)
byName(parenMethod())        // ✅ expression: the *result* of calling it
byName(parenMethod)          // ✅ GOTCHA! This is NOT "pass a reference" — it evaluates to parenMethod()
byName(() => 42)()           // ✅ call a lambda inline

// BY-FUNCTION needs an actual function value:
byFunction(() => 42)         // ✅ lambda directly
byFunction(parenMethod)      // ✅ ETA-expands parenMethod into () => parenMethod()
byFunction(method)           // ❌ DOES NOT COMPILE — no-paren method not recognized as function-shaped
byFunction(parenMethod _)    // ✅ explicit PAF (but unnecessary — parenMethod already compiles above)
```

**The key gotcha:** `byName(parenMethod)` does **not** pass a reference to
`parenMethod`; it immediately calls `parenMethod()` and passes the `Int` result.
If you wanted lazy evaluation, you'd need `byName(() => parenMethod())` or wrap
it in a lambda. This is why by-name is subtle — it looks like you're passing
something unevaluated, but you're really just passing an expression that gets
deferred.

## Key takeaway

**Functions and methods are different on the JVM.** Methods live on classes; functions
are objects. ETA-expansion is the compiler magic that converts a method into a function
value (an instance of `Function1`, etc.) when context demands it.

**Currying** (multiple parameter lists) and **PAF** (partial application with `_`)
are two separate compositional techniques:
- Currying: `def f(x: Int)(y: Int)` lets you supply arguments one list at a time.
- PAF: `f(7, _)` or `f(7) _` fixes some arguments and leaves others open.
- Together, they let you build reusable, partially-configured functions without
  writing manual `(x) => ...` wrappers — the idiomatic way to do this is with
  the underscore placeholder.

**By-name vs. by-function** are fundamentally different mechanisms that happen to
look similar. By-name (`=> T`) defers an expression and re-evaluates it on each
reference; by-function (`() => T`) is an actual function object you must call. Don't
confuse them at call sites — `byName(method)` and `byFunction(method)` have very
different behavior, and only the second compiles for no-paren methods.

---

## Exercises

Try these in `src/playground/ScalaPlayground.scala` (or a scratch file):

1. **Idiomatic PAF practice.** Write a curried method `def times(factor: Int)(x: Int): Int = factor * x`.
   Build a `double: Int => Int` using the idiomatic underscore syntax (`times(2, _)`), then a
   `triple` version. Apply both to `List(1,2,3).map(double)` and confirm they work. (Hint: if you get a
   compile error, check whether you need `: Int` after the underscore to disambiguate the type.)

2. **Multi-slot PAF.** Write `def greet(greeting: String, name: String, punctuation: String): String = greeting + name + punctuation`.
   Using underscores in different positions, build: (a) a `String => String` function that fixes
   `greeting` and `punctuation` but leaves `name` open (call it `insertName`), and (b) a
   `(String, String) => String` function that fixes only `greeting`, leaving `name` and `punctuation`
   open (call it `fillBlanks`). Print the result of calling each.

3. **By-name re-evaluation.** Write `def byNameTest(x: => Int) = { println("first"); val r = x; println("second"); x + r }`.
   Call it with `byNameTest({ println("computing"); 42 })`. How many times does "computing" print, and in
   what order? Why? (Contrast this with the same method signature but `() => Int`, which would require you to
   call `x()` explicitly.)

4. **By-name vs. by-function gotcha.** Define:
   ```scala
   def method: Int = { println("method called"); 99 }
   def parenMethod(): Int = { println("parenMethod called"); 100 }
   
   def byName(x: => Int) = x
   def byFunction(f: () => Int) = f()
   ```
   Try calling `byName(method)`, `byName(parenMethod)`, and `byFunction(method)`. Which compile, which don't,
   and why? (The goal: understand why `byName(parenMethod)` doesn't defer the call, and why `byFunction(method)`
   fails — no paren method doesn't trigger ETA-expansion for by-function params.)
