File used to maintain reference state between Claude conversations

# Bluesky API Data Structures Reference

This document outlines the JSON structures returned by various Bluesky API endpoints to guide refactoring and common function development.

## API Endpoints Overview

### 1. Author Feed (`app.bsky.feed.getAuthorFeed`)
**Structure**: `{ feed: [...], cursor: "..." }`
- Returns array of **feed items** with post + reply context
- Used for: Profile feeds with post type filtering

### 2. Thread (`app.bsky.feed.getPostThread`) 
**Structure**: `{ thread: {...} }`
- Returns nested thread structure
- Used for: Reply extraction

### 3. Search Posts (`app.bsky.feed.searchPosts`)
**Structure**: `{ posts: [...], cursor: "..." }`
- Returns flat array of **posts** only
- Used for: Search results, quote detection

### 4. Custom Feed (`app.bsky.feed.getFeed`)
**Structure**: `{ feed: [...], cursor: "..." }`
- Same as author feed structure

### 5. List Feed (`app.bsky.feed.getListFeed`)
**Structure**: `{ feed: [...], cursor: "..." }`
- Same as author feed structure

## Core Data Structures

### Feed Item (Author/Custom/List Feeds)
```json
{
  "post": {
    "uri": "at://did:plc:xxx/app.bsky.feed.post/xxx",
    "cid": "bafyxxx",
    "author": { /* Author Object */ },
    "record": { /* Post Record */ },
    "embed": { /* Embed Object */ },
    "replyCount": 0,
    "repostCount": 0, 
    "likeCount": 0,
    "quoteCount": 0,
    "indexedAt": "2025-05-23T18:40:09.956Z",
    "labels": []
  },
  "reason": { /* Present for reposts */
    "$type": "app.bsky.feed.defs#reasonRepost",
    "by": { /* Author Object */ },
    "indexedAt": "..."
  },
  "reply": { /* Present when post is in reply context */
    "root": { /* Post Object */ },
    "parent": { /* Post Object */ }
  }
}
```

### Post Object (Direct from Search/Thread)
```json
{
  "uri": "at://did:plc:xxx/app.bsky.feed.post/xxx",
  "cid": "bafyxxx", 
  "author": { /* Author Object */ },
  "record": { /* Post Record */ },
  "embed": { /* Embed Object */ },
  "replyCount": 0,
  "repostCount": 0,
  "likeCount": 0, 
  "quoteCount": 0,
  "indexedAt": "2025-05-23T18:40:09.956Z",
  "labels": []
}
```

### Author Object
```json
{
  "did": "did:plc:r2whjvupgfw55mllpksnombn",
  "handle": "austegard.com",
  "displayName": "Oskar",
  "avatar": "https://cdn.bsky.app/img/avatar/...",
  "labels": [],
  "createdAt": "2024-11-11T03:12:23.280Z",
  "associated": { /* Optional */
    "chat": { "allowIncoming": "all" }
  }
}
```

### Post Record Object  
```json
{
  "$type": "app.bsky.feed.post",
  "createdAt": "2025-05-23T18:40:06.447Z",
  "text": "Post content here",
  "langs": ["en"],
  "facets": [ /* Rich text features */
    {
      "features": [
        {
          "$type": "app.bsky.richtext.facet#link",
          "uri": "https://example.com"
        },
        {
          "$type": "app.bsky.richtext.facet#tag", 
          "tag": "hashtag"
        },
        {
          "$type": "app.bsky.richtext.facet#mention",
          "did": "did:plc:xxx"
        }
      ],
      "index": { "byteStart": 0, "byteEnd": 10 }
    }
  ],
  "reply": { /* Present for replies */
    "parent": { "uri": "...", "cid": "..." },
    "root": { "uri": "...", "cid": "..." }
  },
  "embed": { /* Embedded content */ }
}
```

### Embed Types

#### Images
```json
{
  "$type": "app.bsky.embed.images",
  "images": [
    {
      "alt": "Description",
      "aspectRatio": { "height": 1516, "width": 1662 },
      "image": { "$type": "blob", "ref": { "$link": "bafyxxx" }, "mimeType": "image/jpeg", "size": 670142 }
    }
  ]
}
```

#### Record (Quote Posts)
```json
{
  "$type": "app.bsky.embed.record",
  "record": { "cid": "bafyxxx", "uri": "at://did:plc:xxx/app.bsky.feed.post/xxx" }
}
```

#### Record with Media (Quote + Media)
```json
{
  "$type": "app.bsky.embed.recordWithMedia", 
  "record": { "$type": "app.bsky.embed.record", "record": { "cid": "...", "uri": "..." } },
  "media": { "$type": "app.bsky.embed.images", "images": [...] }
}
```

#### External Link
```json
{
  "$type": "app.bsky.embed.external",
  "external": {
    "uri": "https://example.com",
    "title": "Page Title",
    "description": "Page description", 
    "thumb": { "$type": "blob", "ref": { "$link": "bafyxxx" }, "mimeType": "image/jpeg", "size": 88751 }
  }
}
```

### Thread Structure
```json
{
  "thread": {
    "$type": "app.bsky.feed.defs#threadViewPost",
    "post": { /* Post Object */ },
    "replies": [
      {
        "$type": "app.bsky.feed.defs#threadViewPost", 
        "post": { /* Post Object */ },
        "replies": [ /* Nested replies */ ],
        "threadContext": {}
      }
    ],
    "threadContext": {}
  }
}
```

## Post Type Detection Logic

### Repost Detection
- **Source**: Feed items only (not available in direct post arrays)
- **Method**: Check for `item.reason.$type === "app.bsky.feed.defs#reasonRepost"`

### Quote Post Detection  
- **Source**: Any post object
- **Method**: Check `post.record.embed.$type` for:
  - `"app.bsky.embed.record"` (quote only)
  - `"app.bsky.embed.recordWithMedia"` (quote + media)

### Reply Detection
- **Source**: Any post object  
- **Method**: Check for `post.record.reply` field

### Self-Reply/Thread Detection
- **Source**: Any post object with reply field
- **Method**: Compare `post.author.did` with parent post DID extracted from `post.record.reply.parent.uri`
- **URI Format**: `at://did:plc:xxx/app.bsky.feed.post/xxx` where middle segment is the DID

### Media Detection
- **Source**: Any post object
- **Method**: Check `post.record.embed.$type` for:
  - `"app.bsky.embed.images"`
  - `"app.bsky.embed.recordWithMedia"` (has both quote + media)
  - Exclude pure quote embeds (`"app.bsky.embed.record"`)

### Link Detection
- **Source**: Any post object
- **Method**: Check `post.record.facets` for features with `$type === "app.bsky.richtext.facet#link"`

## Common Anonymization Fields

### Standard Post Fields
```json
{
  "id": "post_1", 
  "text": "Post content",
  "createdAt": "2025-05-23T18:40:06.447Z",
  "likeCount": 0,
  "replyCount": 0, 
  "repostCount": 0,
  "quoteCount": 0, // Only available in some contexts
  "postType": "original|repost|quote|reply|thread",
  "hasMedia": true,
  "hasLinks": true,
  "language": "en"
}
```

### Additional Fields by Context
- **Feed Processing**: Include `postType` detection
- **Quote Processing**: Include `quotedPostSnippet` 
- **Reply Processing**: Simpler structure without post type complexity

## Key Differences by Endpoint

| Endpoint | Container | Post Access | Repost Detection | Reply Context |
|----------|-----------|-------------|------------------|---------------|
| Author Feed | `feed[]` | `item.post` | ✅ `item.reason` | ✅ `item.reply` |
| Custom Feed | `feed[]` | `item.post` | ✅ `item.reason` | ✅ `item.reply` |  
| List Feed | `feed[]` | `item.post` | ✅ `item.reason` | ✅ `item.reply` |
| Search Posts | `posts[]` | Direct | ❌ Not available | ❌ Not available |
| Thread | `thread` | `thread.post` | ❌ Not available | ✅ Via structure |

## Alt Text Extraction

### Image Alt Text
- **Location**: `post.record.embed.images[].alt`
- **Media with Record**: `post.record.embed.media.images[].alt`
- **Viewed Embeds**: `post.embed.images[].alt` or `post.embed.media.images[].alt`

### External Link Alt Text  
- **Location**: `post.record.embed.external.thumb` (no alt text for external links)
- **Note**: External links don't typically have alt text, just thumbnails

## Refactoring Recommendations

1. **Unified Post Extraction**: Create function to extract post object regardless of source
2. **Unified Type Detection**: Single function that works with available data context  
3. **Unified Anonymization**: Core function with optional fields based on available data
4. **URL Parsing**: Centralize handle/DID/post ID extraction logic
5. **Alt Text Extraction**: Unified function to extract all alt text from embeds
6. **Error Handling**: Consistent patterns across all endpoints
