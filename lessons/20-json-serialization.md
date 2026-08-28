# Lesson 20 — JSON Serialization (implicits case study)

Source: `src/lectures/part4implicits/JSONSerialization.scala`

This lesson doesn't teach a new mechanism. It's a **capstone**: lessons 15
(`TypeClasses.scala`) and 17 (`MyTypeClassTemplate.scala`) taught you the
type-class recipe — trait + implicit instances + a summoner/ops layer.
This file applies that exact recipe to solve a real problem: turning
arbitrary Scala values (`Int`, `String`, your own case classes) into JSON,
*without* touching the definitions of those types. If you understand this
file, you understand why type classes exist.

## 1. The intermediate data type: `JSONValue`

```scala
sealed trait JSONValue {         // line 27
  def stringify: String
}

final case class JSONString(value: String) extends JSONValue {   // line 31
  def stringify: String = "\"" + value + "\""
}

final case class JSONNumber(value: Int) extends JSONValue { ... }  // line 36
final case class JSONArray(values: List[JSONValue]) extends JSONValue { ... }  // line 40
final case class JSONObject(values: Map[String, JSONValue]) extends JSONValue { ... }  // line 44
```

JSON only has four shapes: a string, a number, an array of JSON values, and
an object (string keys → JSON values). `JSONValue` models exactly that as a
`sealed trait` with one `final case class` per shape — the same closed-ADT
discipline as lesson 2's pattern matching (a `sealed` hierarchy means the
compiler can warn you on non-exhaustive matches over it).

Each variant knows how to render *itself* to text via `stringify`
(lines 32-59) — `JSONArray` and `JSONObject` recurse into their children's
`stringify`. This is the **target** of the whole exercise: get any value
into this shape, and `.stringify` (called manually at line 71 on a
hand-built `JSONObject`) gives you a JSON string for free.

The problem this lesson solves: writing `JSONObject(Map("name" ->
JSONString(user.name), ...))` by hand for every `User`, every `Post`, every
`Feed` (lines 63-69 show exactly this tedium) doesn't scale. You want
`user.toJSON` to just work — for types you own (`User`) *and* types you
don't (`Int`, `String`, `List`).

```
JSONValue
 ├── JSONString(value: String)
 ├── JSONNumber(value: Int)
 ├── JSONArray(values: List[JSONValue])
 └── JSONObject(values: Map[String, JSONValue])
```
Every JSON document, however deeply nested, is built from just these four
shapes — that's the entire "target" the rest of the lesson converts into.

## 2. The type class: `JSONConverter[T]`

```scala
trait JSONConverter[T] {          // line 81
  def convert(value: T): JSONValue
}
```

This is lesson 15/17's pattern, verbatim: a **parametric trait** describing
"a thing that knows how to turn a `T` into a `JSONValue`." Nothing here
mentions `User` or `Int` — the trait is generic over *any* `T`. That
genericity is the whole point: `JSONConverter[T]` is a *capability*, not a
type extension. `User` never needs to `extends JSONConverter` or
`extends JSONValue` — the conversion logic lives *outside* the type,
exactly like `HTMLSerializer[T]` lived outside `User` in lesson 15's
`TypeClasses.scala`.

Compare to lesson 17's bare-bones template:

```scala
trait MyTypeClassTemplate[T] { def action(value: T): String }
```

`JSONConverter[T]` is the same shape with `convert(value: T): JSONValue`
standing in for `action`. That's not a coincidence — it's the reusable
skeleton every type class in this codebase follows.

## 3. Instances: teaching the type class about concrete types

```scala
implicit object StringConverter extends JSONConverter[String] {   // line 95
  def convert(value: String): JSONValue = JSONString(value)
}

implicit object NumberConverter extends JSONConverter[Int] {      // line 99
  def convert(value: Int): JSONValue = JSONNumber(value)
}

implicit object UserConverter extends JSONConverter[User] {       // line 104
  def convert(user: User): JSONValue = JSONObject(Map(
    "name" -> JSONString(user.name),
    "age" -> JSONNumber(user.age),
    "email" -> JSONString(user.email)
  ))
}
```

Each `implicit object` is one **instance** of the type class — a proof that
"yes, I know how to convert *this specific type*." `StringConverter` and
`NumberConverter` extend the library types `String`/`Int` that you can't
modify; `UserConverter` extends your own `User` case class (defined at line
17) that you *could* modify but shouldn't have to just to gain JSON
support. Marking them `implicit` is what lets the compiler find and supply
the right one automatically later, without you writing
`UserConverter.convert(john)` by hand everywhere.

Gotcha: there's no companion-object summoner here (`JSONConverter.apply`,
the way `HTMLSerializer.apply` worked in lesson 15) — this file skips
straight to the ops layer below. You don't strictly need the summoner; it's
only useful if you want to write `JSONConverter[User]` to fetch an instance
directly. `implicitly[JSONConverter[User]]` (lesson 15's other summoning
trick) would also work here without any extra code, since the compiler's
implicit search doesn't care whether you wrap it in an `apply`.

## 4. Composing instances: converters call `.toJSON` on their fields

```scala
implicit object PostConverter extends JSONConverter[Post] {        // line 112
  def convert(post: Post): JSONValue = JSONObject(Map(
    "content" -> JSONString(post.content),
    "created:" -> JSONString(post.createdAt.toString)
  ))
}

implicit object FeedConverter extends JSONConverter[Feed] {        // line 119
  def convert(feed: Feed): JSONValue = JSONObject(Map(
    "user" -> feed.user.toJSON,
    "posts" -> JSONArray(feed.posts.map(_.toJSON))
  ))
}
```

This is the "aha" moment. `Feed` is `case class Feed(user: User, posts:
List[Post])` (line 19) — a composite of a `User` and a `List[Post]`.
`FeedConverter` doesn't hand-write JSON for a user or a post; it calls
`feed.user.toJSON` and `_.toJSON` on each post, and the compiler resolves
those calls to `UserConverter` and `PostConverter` **implicitly**, purely
because `feed.user`'s static type is `User` and each list element's type is
`Post`. `FeedConverter` doesn't know or care which converter gets picked —
it just needs *some* `JSONConverter[User]` and `JSONConverter[Post]` to
exist in scope.

```
FeedConverter.convert(feed)
 ├─ needs JSONConverter[User]  ──▶ resolved implicitly ──▶ UserConverter
 └─ needs JSONConverter[Post]  ──▶ resolved implicitly ──▶ PostConverter (× each element)
```
That's type classes composing: a converter for a composite type (`Feed`) is
built out of converters for its component types (`User`, `Post`), wired
together by implicit resolution instead of by hand. Scale this up and a
converter for `List[Post]` is really just "map `toJSON` over the elements,
wrap in `JSONArray`" — which is exactly what line 122 does inline, one
call site at a time, rather than as a standalone reusable instance (see
Exercise 2 below for turning that into one).

Gotcha: `PostConverter` (line 112) is *not* fully composed — it converts
`post.createdAt` with `.toString` instead of delegating to a
`JSONConverter[Date]`. Nothing stops you from writing sloppy instances
alongside well-composed ones; the type class discipline is a convention the
compiler enforces at the *call site* (you need *some* instance in scope),
not a guarantee that every instance internally composes cleanly.

## 5. The call-site sugar: `implicit class JSONOps`

```scala
implicit class JSONOps[T](value: T) {         // line 87
  def toJSON(implicit converter: JSONConverter[T]): JSONValue =
    converter.convert(value)
}
```

This is the "pimp my library" step from lesson 15's `HTMLEnrichment`,
applied here as `JSONOps`. It enriches **every** type `T` with a `.toJSON`
method, provided a `JSONConverter[T]` instance is implicitly available. So:

```scala
println(feed.toJSON.stringify)   // line 134
```

desugars to `new JSONOps(feed).toJSON(FeedConverter).stringify` — the
compiler inserts the implicit class wrapper *and* fills in the implicit
`converter` parameter by searching for a `JSONConverter[Feed]` in scope,
which resolves to `FeedConverter`. Chained through `FeedConverter`'s
internal `.toJSON` calls (section 4), one top-level `feed.toJSON` recursively
drives the whole nested `User`/`List[Post]` structure into `JSONValue`, and
`.stringify` (section 1) renders the result to a JSON string.

## Key takeaway

`JSONConverter[T]` is lesson 15/17's type-class skeleton doing real work:
the trait separates "how to convert" from the types being converted, the
`implicit object` instances teach it about specific types one at a time
(including types you don't own, like `Int`/`String`), and the `toJSON`
implicit-class sugar makes the whole thing invisible at the call site —
`feed.toJSON` reads like a method on `Feed`, but `Feed` never declared it.
The extra insight this file adds on top of lesson 15: instances for
composite types (`FeedConverter`) don't need to know how to serialize their
parts — they just call `.toJSON` on each field and let implicit resolution
supply the right converter, recursively. That's how type classes scale from
one type to a whole object graph.

---

## Exercises

1. Add `implicit object BooleanConverter extends JSONConverter[Boolean]`
   that converts to a new `JSONBool(value: Boolean) extends JSONValue`
   variant (you'll need to add `JSONBool` to the ADT and its `stringify`).
   Confirm `true.toJSON.stringify` prints `true` with no quotes.
2. Write a **generic** instance
   `implicit def listConverter[T](implicit conv: JSONConverter[T]): JSONConverter[List[T]]`
   that converts any `List[T]` by mapping `.toJSON` over the elements and
   wrapping in `JSONArray`. Then simplify `FeedConverter` to
   `"posts" -> feed.posts.toJSON` instead of the hand-rolled
   `JSONArray(feed.posts.map(_.toJSON))` at line 122. This is the fully
   generic version of the composition described in section 4.
3. Fix the `PostConverter` gotcha from section 4: define
   `implicit object DateConverter extends JSONConverter[Date]` (serialize
   however you like — ISO string, epoch millis, etc.) and rewrite
   `PostConverter` to use `post.createdAt.toJSON` instead of
   `JSONString(post.createdAt.toString)`, so every converter in the file
   composes cleanly through implicit resolution.
