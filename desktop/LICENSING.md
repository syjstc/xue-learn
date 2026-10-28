# License scope

XueLearn's own Core and Electron source code, tests, build tools, schemas and
associated developer documentation in this public distribution use the standard
[MIT License](LICENSE). Commercial use, modification and redistribution of that
code are permitted, with the required copyright and permission notices retained.
Existing third-party notices and licenses take precedence for third-party work.

The following materials have separate terms:

| Material | Applicable terms |
| --- | --- |
| XueLearn logos, wordmarks, application icons and branded installer backgrounds listed in [BRAND_ASSETS.json](BRAND_ASSETS.json) | [Brand Asset License](LICENSE-BRAND): noncommercial use, with the private-use exceptions stated there; commercial branding requires written permission |
| The XueLearn and 好会学 names and product identity | [Brand policy](BRAND_POLICY.md); the code license grants no trademark rights |
| Third-party code, fonts, artwork and other dependencies | Their original licenses and notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |
| Other bundled media, including scenario/character artwork, portraits and audio | Any license supplied for that particular asset; this code-license grant does not newly license those media files. Where no asset license is supplied, obtain permission or replace the asset before redistribution |

The last row includes media under `public/scenario-theater/`,
`public/teaching-personas/` and `public/audio/`. It also includes standalone media
under `public/` that are neither listed as XueLearn brand assets nor accompanied
by their own license. This preserves their existing status instead of assigning
them an unsupported license. The Kenney desk model, for example, retains its
included CC0 license.

Implementation files such as `src/components/brand/brand-logo.tsx`,
`public/site.webmanifest`, packaging configuration and localization strings remain
under MIT to the extent they are XueLearn's own code/configuration. Referencing a
brand image does not make that implementation noncommercial. The image and the
use of a name as a product mark still follow their separate terms.

You may build a paid product or service from the MIT code. Use your own product
name and visual identity, replace the listed brand images, and retain the MIT
copyright/permission notice. Check the separate terms of any other assets and
dependencies you redistribute. Required attribution and truthful statements such
as "Based on XueLearn" are allowed under the brand policy.

This scope applies to the public Core + Desktop distribution and the files from
it included in a library artifact. Inventory paths refer to the `desktop/`
directory; an artifact may contain only a subset. This grant does not include private
products, the integration repository's remaining files/history, learner content
or user data. License metadata in a code package describes its own code and does
not override the separate asset licenses above.

中文说明：本公开版本中的自有 Core、Electron 代码采用 MIT，允许商用、修改和再发布，
须保留版权和许可声明。清单中的 Logo、图标和品牌美术单独授权，不允许未经书面授权用于
商业品牌；公司内部正常运行、学习和开发不受此限制。第三方内容及其他媒体素材保留各自
原有授权状态。品牌条款不会收回 MIT 已授予的代码权利。
