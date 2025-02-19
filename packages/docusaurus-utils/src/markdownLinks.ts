/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import {getContentPathList} from './dataFileUtils';
import {aliasedSitePath} from './pathUtils';

/**
 * Content plugins have a base path and a localized path to source content from.
 * We will look into the localized path in priority.
 */
export type ContentPaths = {
  /**
   * The absolute path to the base content directory, like `"<siteDir>/docs"`.
   */
  contentPath: string;
  /**
   * The absolute path to the localized content directory, like
   * `"<siteDir>/i18n/zh-Hans/plugin-content-docs"`.
   */
  contentPathLocalized: string;
};

/** Data structure representing each broken Markdown link to be reported. */
export type BrokenMarkdownLink<T extends ContentPaths> = {
  /** Absolute path to the file containing this link. */
  filePath: string;
  /**
   * This is generic because it may contain extra metadata like version name,
   * which the reporter can provide for context.
   */
  contentPaths: T;
  /**
   * The content of the link, like `"./brokenFile.md"`
   */
  link: string;
};

/**
 * Takes a Markdown file and replaces relative file references with their URL
 * counterparts, e.g. `[link](./intro.md)` => `[link](/docs/intro)`, preserving
 * everything else.
 *
 * This method uses best effort to find a matching file. The file reference can
 * be relative to the directory of the current file (most likely) or any of the
 * content paths (so `/tutorials/intro.md` can be resolved as
 * `<siteDir>/docs/tutorials/intro.md`). Links that contain the `http(s):` or
 * `@site/` prefix will always be ignored.
 */
export function replaceMarkdownLinks<T extends ContentPaths>({
  siteDir,
  fileString,
  filePath,
  contentPaths,
  sourceToPermalink,
}: {
  /** Absolute path to the site directory, used to resolve aliased paths. */
  siteDir: string;
  /** The Markdown file content to be processed. */
  fileString: string;
  /** Absolute path to the current file containing `fileString`. */
  filePath: string;
  /** The content paths which the file reference may live in. */
  contentPaths: T;
  /**
   * A map from source paths to their URLs. Source paths are `@site` aliased.
   */
  sourceToPermalink: {[aliasedPath: string]: string};
}): {
  /**
   * The content with all Markdown file references replaced with their URLs.
   * Unresolved links are left as-is.
   */
  newContent: string;
  /** The list of broken links,  */
  brokenMarkdownLinks: BrokenMarkdownLink<T>[];
} {
  const brokenMarkdownLinks: BrokenMarkdownLink<T>[] = [];

  // Replace internal markdown linking (except in fenced blocks).
  let fencedBlock = false;
  let lastCodeFence = '';
  const lines = fileString.split('\n').map((line) => {
    if (line.trim().startsWith('```')) {
      const codeFence = line.trim().match(/^`+/)![0]!;
      if (!fencedBlock) {
        fencedBlock = true;
        lastCodeFence = codeFence;
        // If we are in a ````-fenced block, all ``` would be plain text instead
        // of fences
      } else if (codeFence.length >= lastCodeFence.length) {
        fencedBlock = false;
      }
    }
    if (fencedBlock) {
      return line;
    }

    let modifiedLine = line;
    // Replace inline-style links or reference-style links e.g:
    // This is [Document 1](doc1.md)
    // [doc1]: doc1.md
    const mdRegex =
      /(?:\]\(|\]:\s*)(?!https?:\/\/|@site\/)(?<filename>[^'")\]\s>]+\.mdx?)/g;
    let mdMatch = mdRegex.exec(modifiedLine);
    while (mdMatch !== null) {
      // Replace it to correct html link.
      const mdLink = mdMatch.groups!.filename!;

      const sourcesToTry: string[] = [];
      // ./file.md and ../file.md are always relative to the current file
      if (!mdLink.startsWith('./') && !mdLink.startsWith('../')) {
        sourcesToTry.push(...getContentPathList(contentPaths), siteDir);
      }
      // /file.md is always relative to the content path
      if (!mdLink.startsWith('/')) {
        sourcesToTry.push(path.dirname(filePath));
      }

      const aliasedSourceMatch = sourcesToTry
        .map((p) => path.join(p, decodeURIComponent(mdLink)))
        .map((source) => aliasedSitePath(source, siteDir))
        .find((source) => sourceToPermalink[source]);

      const permalink: string | undefined = aliasedSourceMatch
        ? sourceToPermalink[aliasedSourceMatch]
        : undefined;

      if (permalink) {
        // MDX won't be happy if the permalink contains a space, we need to
        // convert it to %20
        const encodedPermalink = permalink
          .split('/')
          .map((part) => part.replace(/\s/g, '%20'))
          .join('/');
        modifiedLine = modifiedLine.replace(mdLink, encodedPermalink);
      } else {
        const brokenMarkdownLink: BrokenMarkdownLink<T> = {
          contentPaths,
          filePath,
          link: mdLink,
        };

        brokenMarkdownLinks.push(brokenMarkdownLink);
      }
      mdMatch = mdRegex.exec(modifiedLine);
    }
    return modifiedLine;
  });

  const newContent = lines.join('\n');

  return {newContent, brokenMarkdownLinks};
}
