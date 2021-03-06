import { GraphQLResolveInfo } from 'graphql';
import { gql, IResolvers } from 'apollo-server-fastify';
import { Context } from '../Context';
import { traceResolvers } from './trace';
import {
  anonymousFeedBuilder,
  AnonymousFeedFilters,
  base64,
  configuredFeedBuilder,
  FeedArgs,
  feedResolver,
  getCursorFromAfter,
  randomPostsResolver,
  Ranking,
  sourceFeedBuilder,
  tagFeedBuilder,
  whereKeyword,
} from '../common';
import { In, SelectQueryBuilder } from 'typeorm';
import {
  BookmarkList,
  Feed,
  FeedSource,
  FeedTag,
  Post,
  Source,
} from '../entity';
import { GQLSource } from './sources';
import { offsetPageGenerator, Page, PageGenerator } from './common';
import { GQLPost } from './posts';
import { Connection, ConnectionArguments } from 'graphql-relay';
import graphorm from '../graphorm';

export const typeDefs = gql`
  type FeedSettings {
    id: String
    userId: String
    includeTags: [String]
    blockedTags: [String]
    excludeSources: [Source]
  }

  type SearchPostSuggestion {
    title: String!
  }

  type SearchPostSuggestionsResults {
    query: String!
    hits: [SearchPostSuggestion!]!
  }

  type RSSFeed {
    name: String!
    url: String!
  }

  enum Ranking {
    """
    Rank by a combination of time and views
    """
    POPULARITY
    """
    Rank by time only
    """
    TIME
  }

  input FiltersInput {
    """
    Include posts of these sources
    """
    includeSources: [ID!]

    """
    Exclude posts of these sources
    """
    excludeSources: [ID!]

    """
    Posts must include at least one tag from this list
    """
    includeTags: [String!]

    """
    Posts must not include even one tag from this list
    """
    blockedTags: [String!]
  }

  extend type Query {
    """
    Get an ad-hoc feed based on sources and tags filters
    """
    anonymousFeed(
      """
      Time the pagination started to ignore new items
      """
      now: DateTime

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Ranking criteria for the feed
      """
      ranking: Ranking = POPULARITY

      """
      Filters to apply to the feed
      """
      filters: FiltersInput
    ): PostConnection!

    """
    Get a configured feed
    """
    feed(
      """
      Time the pagination started to ignore new items
      """
      now: DateTime

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Ranking criteria for the feed
      """
      ranking: Ranking = POPULARITY

      """
      Return only unread posts
      """
      unreadOnly: Boolean = false
    ): PostConnection! @auth

    """
    Get a single source feed
    """
    sourceFeed(
      """
      Id of the source
      """
      source: ID!

      """
      Time the pagination started to ignore new items
      """
      now: DateTime

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Ranking criteria for the feed
      """
      ranking: Ranking = POPULARITY
    ): PostConnection!

    """
    Get a single tag feed
    """
    tagFeed(
      """
      The tag to fetch
      """
      tag: String!

      """
      Time the pagination started to ignore new items
      """
      now: DateTime

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Ranking criteria for the feed
      """
      ranking: Ranking = POPULARITY
    ): PostConnection!

    """
    Get a single keyword feed
    """
    keywordFeed(
      """
      The keyword to fetch
      """
      keyword: String!

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Ranking criteria for the feed
      """
      ranking: Ranking = POPULARITY
    ): PostConnection!

    """
    Get the user's default feed settings
    """
    feedSettings: FeedSettings! @auth

    """
    Get suggestions for search post query
    """
    searchPostSuggestions(
      """
      The query to search for
      """
      query: String!
    ): SearchPostSuggestionsResults!

    """
    Get a posts feed of a search query
    """
    searchPosts(
      """
      The query to search for
      """
      query: String!

      """
      Time the pagination started to ignore new items
      """
      now: DateTime

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int
    ): PostConnection!

    """
    Returns the user's RSS feeds
    """
    rssFeeds: [RSSFeed!]! @auth

    """
    Get a single author feed
    """
    authorFeed(
      """
      Id of the author
      """
      author: ID!

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Ranking criteria for the feed
      """
      ranking: Ranking = POPULARITY
    ): PostConnection!

    """
    Get the most upvoted articles in the past 7 days feed
    """
    mostUpvotedFeed(
      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Number of days since publication
      """
      period: Int
    ): PostConnection!

    """
    Get the most discussed articles
    """
    mostDiscussedFeed(
      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int
    ): PostConnection!

    """
    Get random trending posts
    """
    randomTrendingPosts(
      """
      Post ID to filter out
      """
      post: ID

      """
      Paginate first
      """
      first: Int
    ): [Post]!

    """
    Get random similar posts to a given post
    """
    randomSimilarPosts(
      """
      Post ID
      """
      post: ID!

      """
      Paginate first
      """
      first: Int
    ): [Post]!

    """
    Get random similar posts by tags
    """
    randomSimilarPostsByTags(
      """
      Array of tags
      """
      tags: [String]!

      """
      Post ID
      """
      post: ID

      """
      Paginate first
      """
      first: Int
    ): [Post]!

    """
    Get random best discussion posts
    """
    randomDiscussedPosts(
      """
      Post ID to filter out
      """
      post: ID

      """
      Paginate first
      """
      first: Int
    ): [Post]!
  }

  extend type Mutation {
    """
    Add new filters to the user's feed
    """
    addFiltersToFeed(
      """
      The filters to add to the feed
      """
      filters: FiltersInput!
    ): FeedSettings @auth

    """
    Remove filters from the user's feed
    """
    removeFiltersFromFeed(
      """
      The filters to remove from the feed
      """
      filters: FiltersInput!
    ): FeedSettings @auth
  }
`;

export interface GQLRSSFeed {
  name: string;
  url: string;
}

export interface GQLFeedSettings {
  id: string;
  userId: string;
  includeTags: string[];
  blockedTags: string[];
  excludeSources: GQLSource[];
}

export type GQLFiltersInput = AnonymousFeedFilters;

interface GQLSearchPostSuggestion {
  title: string;
}

export interface GQLSearchPostSuggestionsResults {
  query: string;
  hits: GQLSearchPostSuggestion[];
}

interface AnonymousFeedArgs extends FeedArgs {
  filters?: GQLFiltersInput;
}

interface ConfiguredFeedArgs extends FeedArgs {
  unreadOnly: boolean;
}

interface SourceFeedArgs extends FeedArgs {
  source: string;
}

interface TagFeedArgs extends FeedArgs {
  tag: string;
}

interface KeywordFeedArgs extends FeedArgs {
  keyword: string;
}

interface AuthorFeedArgs extends FeedArgs {
  author: string;
}

interface FeedPage extends Page {
  timestamp?: Date;
  score?: number;
}

const feedPageGenerator: PageGenerator<GQLPost, FeedArgs, FeedPage> = {
  connArgsToPage: ({ ranking, first, after }: FeedArgs) => {
    const cursor = getCursorFromAfter(after);
    // Increment by one to determine if there's one more page
    const limit = Math.min(first || 30, 50) + 1;
    if (cursor) {
      if (ranking === Ranking.POPULARITY) {
        return { limit, score: parseInt(cursor) };
      }
      return { limit, timestamp: new Date(parseInt(cursor)) };
    }
    return { limit };
  },
  nodeToCursor: (page, { ranking }, node) => {
    if (ranking === Ranking.POPULARITY) {
      return base64(`score:${node.score}`);
    }
    return base64(`time:${new Date(node.createdAt).getTime()}`);
  },
  hasNextPage: (page, nodesSize) => page.limit === nodesSize,
  hasPreviousPage: (page) => !!(page.score || page.timestamp),
  transformNodes: (page, nodes) => nodes.slice(0, page.limit - 1),
};

const applyFeedPaging = (
  ctx: Context,
  { ranking }: FeedArgs,
  page: FeedPage,
  builder: SelectQueryBuilder<Post>,
  alias,
): SelectQueryBuilder<Post> => {
  let newBuilder = builder
    .addSelect(
      ranking === Ranking.POPULARITY
        ? `${alias}.score as score`
        : `${alias}."createdAt" as "createdAt"`,
    )
    .limit(page.limit)
    .orderBy(
      ranking === Ranking.POPULARITY
        ? `${alias}.score`
        : `${alias}."createdAt"`,
      'DESC',
    );
  if (page.score) {
    newBuilder = newBuilder.andWhere(`${alias}.score < :score`, {
      score: page.score,
    });
  } else if (page.timestamp) {
    newBuilder = newBuilder.andWhere(`${alias}."createdAt" < :timestamp`, {
      timestamp: page.timestamp,
    });
  }
  return newBuilder;
};

const discussedPageGenerator: PageGenerator<
  GQLPost,
  ConnectionArguments,
  FeedPage
> = {
  connArgsToPage: ({ first, after }: FeedArgs) => {
    const cursor = getCursorFromAfter(after);
    // Increment by one to determine if there's one more page
    const limit = Math.min(first || 30, 50) + 1;
    if (cursor) {
      return { limit, score: parseInt(cursor) };
    }
    return { limit };
  },
  nodeToCursor: (page, args, node) => base64(`score:${node.discussionScore}`),
  hasNextPage: (page, nodesSize) => page.limit === nodesSize,
  hasPreviousPage: (page) => !!page.score,
  transformNodes: (page, nodes) => nodes.slice(0, page.limit - 1),
};

const applyDiscussedPaging = (
  ctx: Context,
  args: ConnectionArguments,
  page: FeedPage,
  builder: SelectQueryBuilder<Post>,
  alias,
): SelectQueryBuilder<Post> => {
  let newBuilder = builder
    .addSelect(`${alias}."discussionScore"`)
    .limit(page.limit)
    .orderBy(`${alias}."discussionScore"`, 'DESC');
  if (page.score) {
    newBuilder = newBuilder.andWhere(`${alias}."discussionScore" < :score`, {
      score: page.score,
    });
  }
  return newBuilder;
};

const getFeedSettings = async (
  ctx: Context,
  info: GraphQLResolveInfo,
): Promise<GQLFeedSettings> => {
  const res = await graphorm.query<GQLFeedSettings>(ctx, info, (builder) => {
    builder.queryBuilder = builder.queryBuilder.andWhere(
      `"${builder.alias}".id = :userId AND "${builder.alias}"."userId" = :userId`,
      { userId: ctx.userId },
    );
    return builder;
  });
  if (res.length) {
    return res[0];
  }
  return {
    id: ctx.userId,
    userId: ctx.userId,
    excludeSources: [],
    includeTags: [],
    blockedTags: [],
  };
};

const getSearchQuery = (param: string) => `SELECT to_tsquery('english',
                                                             string_agg(lexeme || ':*', ' & ' order by positions)) AS query
                                           FROM unnest(to_tsvector('english', process_text(${param})))`;

const searchResolver = feedResolver(
  (ctx, { query }: FeedArgs & { query: string }, builder, alias) =>
    builder
      .andWhere(`${alias}.tsv @@ (${getSearchQuery(':query')})`, {
        query,
      })
      .orderBy('views', 'DESC'),
  offsetPageGenerator(30, 50),
  (ctx, args, page, builder) => builder.limit(page.limit).offset(page.offset),
  true,
  false,
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const resolvers: IResolvers<any, Context> = traceResolvers({
  Query: {
    anonymousFeed: feedResolver(
      (ctx, { filters }: AnonymousFeedArgs, builder, alias) =>
        anonymousFeedBuilder(ctx, filters, builder, alias),
      feedPageGenerator,
      applyFeedPaging,
    ),
    feed: feedResolver(
      (ctx, { unreadOnly }: ConfiguredFeedArgs, builder, alias) =>
        configuredFeedBuilder(ctx, ctx.userId, unreadOnly, builder, alias),
      feedPageGenerator,
      applyFeedPaging,
    ),
    sourceFeed: feedResolver(
      (ctx, { source }: SourceFeedArgs, builder, alias) =>
        sourceFeedBuilder(ctx, source, builder, alias),
      feedPageGenerator,
      applyFeedPaging,
      true,
      false,
    ),
    tagFeed: feedResolver(
      (ctx, { tag }: TagFeedArgs, builder, alias) =>
        tagFeedBuilder(ctx, tag, builder, alias),
      feedPageGenerator,
      applyFeedPaging,
    ),
    keywordFeed: feedResolver(
      (ctx, { keyword }: KeywordFeedArgs, builder, alias) =>
        builder.andWhere((subBuilder) =>
          whereKeyword(keyword, subBuilder, alias),
        ),
      feedPageGenerator,
      applyFeedPaging,
    ),
    feedSettings: (source, args, ctx, info): Promise<GQLFeedSettings> =>
      getFeedSettings(ctx, info),
    searchPostSuggestions: async (
      source,
      { query }: { query: string },
      ctx,
    ): Promise<GQLSearchPostSuggestionsResults> => {
      const hits: { title: string }[] = await ctx.con.query(
        `
          WITH search AS (${getSearchQuery('$1')})
          select ts_headline(process_text(title), search.query,
                             'StartSel = <strong>, StopSel = </strong>') as title
          from post,
               search
          where tsv @@ search.query
          order by views desc
          limit 5;
        `,
        [query],
      );
      return {
        query,
        hits,
      };
    },
    searchPosts: async (
      source,
      args: FeedArgs & { query: string },
      ctx,
      info,
    ): Promise<Connection<GQLPost> & { query: string }> => {
      const res = await searchResolver(source, args, ctx, info);
      return {
        ...res,
        query: args.query,
      };
    },
    rssFeeds: async (source, args, ctx): Promise<GQLRSSFeed[]> => {
      const urlPrefix = `${process.env.URL_PREFIX}/rss`;
      const lists = await ctx.getRepository(BookmarkList).find({
        where: { userId: ctx.userId },
        select: ['id', 'name'],
        order: { name: 'ASC' },
      });
      return [
        { name: 'Recent news feed', url: `${urlPrefix}/f/${ctx.userId}` },
        { name: 'Bookmarks', url: `${urlPrefix}/b/${ctx.userId}` },
        ...lists.map((l) => ({
          name: l.name,
          url: `${urlPrefix}/b/l/${l.id.replace(/-/g, '')}`,
        })),
      ];
    },
    authorFeed: feedResolver(
      (ctx, { author }: AuthorFeedArgs, builder, alias) =>
        builder.andWhere(`${alias}.authorId = :author`, {
          author,
        }),
      feedPageGenerator,
      applyFeedPaging,
      false,
      false,
    ),
    mostUpvotedFeed: feedResolver(
      (
        ctx,
        { period }: ConnectionArguments & { period?: number },
        builder,
        alias,
      ) => {
        const interval = [7, 30, 365].find((num) => num === period) ?? 7;
        return builder
          .andWhere(
            `${alias}."createdAt" > now() - interval '${interval} days'`,
          )
          .andWhere(`${alias}."upvotes" >= 10`)
          .orderBy(`${alias}."upvotes"`, 'DESC');
      },
      offsetPageGenerator(30, 50, 100),
      (ctx, args, { limit, offset }, builder) =>
        builder.limit(limit).offset(offset),
      true,
    ),
    mostDiscussedFeed: feedResolver(
      (ctx, args, builder, alias) =>
        builder
          .andWhere(`${alias}."discussionScore" > 0`)
          .orderBy(`${alias}."discussionScore"`, 'DESC'),
      discussedPageGenerator,
      applyDiscussedPaging,
      true,
    ),
    randomTrendingPosts: randomPostsResolver(
      (
        ctx,
        { post }: { post: string | null; first: number | null },
        builder,
        alias,
      ) => {
        let newBuilder = builder.andWhere(`${alias}."trending" > 0`);
        if (post) {
          newBuilder = newBuilder.andWhere(`${alias}."id" != :postId`, {
            postId: post,
          });
        }
        return newBuilder;
      },
      3,
    ),
    randomSimilarPosts: randomPostsResolver(
      (
        ctx,
        { post }: { post: string; first: number | null },
        builder,
        alias,
      ) => {
        const similarPostsQuery = `select post.id
                                   from post
                                          inner join (
                                     select count(*)           as similar,
                                            min(k.occurrences) as occurrences,
                                            pk."postId"
                                     from post_keyword pk
                                            inner join post_keyword pk2 on pk.keyword = pk2.keyword
                                            inner join keyword k on pk.keyword = k.value
                                     where pk2."postId" = :postId
                                       and k.status = 'allow'
                                     group by pk."postId"
                                   ) k on k."postId" = post.id
                                   where post.id != :postId
                                     and post."createdAt" >= now() - interval '6 month'
                                     and post."upvotes" > 0
                                   order by (pow(post.upvotes, k.similar) * 1000 / k.occurrences) desc
                                   limit 25`;
        return builder.andWhere(`${alias}."id" in (${similarPostsQuery})`, {
          postId: post,
        });
      },
      3,
    ),
    randomSimilarPostsByTags: randomPostsResolver(
      (
        ctx,
        {
          tags,
          post,
        }: { tags: string[]; post: string | null; first: number | null },
        builder,
        alias,
      ) => {
        let similarPostsQuery;
        if (tags?.length > 0) {
          similarPostsQuery = `select post.id
                               from post
                                      inner join (
                                 select count(*)           as similar,
                                        min(k.occurrences) as occurrences,
                                        pk."postId"
                                 from post_keyword pk
                                        inner join keyword k on pk.keyword = k.value
                                 where k.value in (:...tags)
                                   and k.status = 'allow'
                                 group by pk."postId"
                               ) k on k."postId" = post.id
                               where post.id != :postId
                                 and post."createdAt" >= now() - interval '6 month'
                               order by (pow(post.upvotes, k.similar) * 1000 / k.occurrences) desc
                               limit 25`;
        } else {
          similarPostsQuery = `select post.id
                               from post
                               where post.id != :postId
                                 and post."createdAt" >= now() - interval '6 month'
                               order by post.upvotes desc
                               limit 25`;
        }
        return builder.andWhere(`${alias}."id" in (${similarPostsQuery})`, {
          postId: post,
          tags,
        });
      },
      3,
    ),
    randomDiscussedPosts: randomPostsResolver(
      (
        ctx,
        { post }: { post: string | null; first: number | null },
        builder,
        alias,
      ) => {
        let newBuilder = builder
          .andWhere(`${alias}."discussionScore" > 0`)
          .andWhere(`${alias}."comments" >= 4`);
        if (post) {
          newBuilder = newBuilder.andWhere(`${alias}."id" != :postId`, {
            postId: post,
          });
        }
        return newBuilder;
      },
      3,
    ),
  },
  Mutation: {
    addFiltersToFeed: async (
      source,
      { filters }: { filters: GQLFiltersInput },
      ctx,
      info,
    ): Promise<GQLFeedSettings> => {
      await ctx.con.transaction(async (manager): Promise<void> => {
        const feedId = ctx.userId;
        await manager.getRepository(Feed).save({
          userId: ctx.userId,
          id: feedId,
        });
        if (filters?.excludeSources?.length) {
          const [query, params] = ctx.con
            .createQueryBuilder()
            .select('id', 'sourceId')
            .addSelect(`'${feedId}'`, 'feedId')
            .from(Source, 'source')
            .where('source.id IN (:...ids)', { ids: filters.excludeSources })
            .getQueryAndParameters();
          await manager.query(
            `insert into feed_source("sourceId", "feedId") ${query}
             on conflict
            do nothing`,
            params,
          );
        }
        if (filters?.includeTags?.length) {
          await manager
            .createQueryBuilder()
            .insert()
            .into(FeedTag)
            .values(
              filters.includeTags.map((s) => ({
                feedId,
                tag: s,
              })),
            )
            .onConflict(`("feedId", "tag") DO UPDATE SET blocked = false`)
            .execute();
        }
        if (filters?.blockedTags?.length) {
          await manager
            .createQueryBuilder()
            .insert()
            .into(FeedTag)
            .values(
              filters.blockedTags.map((s) => ({
                feedId,
                tag: s,
                blocked: true,
              })),
            )
            .onConflict(`("feedId", "tag") DO UPDATE SET blocked = true`)
            .execute();
        }
      });
      return getFeedSettings(ctx, info);
    },
    removeFiltersFromFeed: async (
      source,
      { filters }: { filters: GQLFiltersInput },
      ctx,
      info,
    ): Promise<GQLFeedSettings> => {
      await ctx.con.transaction(async (manager): Promise<void> => {
        const feedId = ctx.userId;
        await ctx.getRepository(Feed).findOneOrFail(feedId);
        if (filters?.excludeSources?.length) {
          await manager.getRepository(FeedSource).delete({
            feedId,
            sourceId: In(filters.excludeSources),
          });
        }
        if (filters?.includeTags?.length) {
          await manager.getRepository(FeedTag).delete({
            feedId,
            tag: In(filters.includeTags),
          });
        }
        if (filters?.blockedTags?.length) {
          await manager.getRepository(FeedTag).delete({
            feedId,
            tag: In(filters.blockedTags),
          });
        }
      });
      return getFeedSettings(ctx, info);
    },
  },
});
