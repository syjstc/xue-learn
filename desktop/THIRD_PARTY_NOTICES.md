# Third-party materials

Third-party code, fonts and media retain their own copyright and license terms.
Neither XueLearn's MIT grant nor its brand license replaces those terms. Preserve
the notices and license files applicable to the components you redistribute.

## Included asset notice

- `src/styles/shadcn.css` is the stylesheet from `shadcn@4.11.0`, copyright
  2023 shadcn, under MIT. Its full license is preserved in
  `third-party/shadcn-LICENSE.md` and in the application license bundle. The
  build uses this stylesheet without installing the unrelated shadcn CLI.

- `public/lab-assets/kenney-furniture-kit/desk.glb`: Kenney Furniture Kit, licensed
  under CC0. The original `public/lab-assets/kenney-furniture-kit/License.txt` and
  the asset's `public/lab-assets/ASSETS.md` are included in the source repository.
  Keep these source notices when copying that asset. They may be absent from a
  code-only artifact that does not contain the model.

## Dependencies and other media

`package.json` and `pnpm-lock.yaml` identify the dependency versions for this
source distribution. Consult each installed package's license and notice files
for its terms, including bundled or downloaded runtime dependencies and fonts.
When distributing an application, preserve the applicable notices for its actual
dependency set, including the licenses supplied with Electron/Chromium/Node and
the font packages. A dependency name here is not a replacement for its license.

Other images and audio without an accompanying license are not
relicensed by the code's MIT grant; see [LICENSING.md](LICENSING.md).

This file identifies the preserved asset notice and where to find dependency
terms; it is not a completed audit of every transitive dependency or media file.
Report missing attribution or permission questions to `contact@xue-learn.com`.
