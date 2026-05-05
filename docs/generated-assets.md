# Generated Asset Maintenance

Generated images live under `generated/`. The Gallery hides invalid image files
and thumbnail cache folders, but broken files can still take disk space during
local development and smoke testing.

## Invalid Image Cleanup

Use the cleanup script in dry-run mode first:

```sh
npm run cleanup:invalid
```

The dry run prints the generated root, invalid image count, matching sidecar
count, and up to the first 20 invalid paths. It does not move or delete files.

To quarantine invalid images and their `.json` sidecars:

```sh
npm run cleanup:invalid -- --apply
```

Files are moved, not deleted, into:

```text
generated/.trash/invalid-cleanup-YYYYMMDD-HHmmss/
```

To inspect another generated root:

```sh
npm run cleanup:invalid -- --root /path/to/generated
```

To clear only the thumbnail cache while leaving generated images alone:

```sh
npm run cleanup:invalid -- --purge-thumbs
```

`--purge-thumbs` is also dry-run unless combined with `--apply`.

## Safety Notes

- The script skips `generated/.trash/` and `generated/.thumbs/` while scanning.
- It checks `.png`, `.jpg`, `.jpeg`, and `.webp` files by image signature and
  `sharp.metadata()`.
- It never permanently deletes generated images. `--apply` moves invalid assets
  and sidecars to `.trash`.
- Gallery thumbnail files are cache only; they can be regenerated.

