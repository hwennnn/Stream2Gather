import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import {
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault
} from '@apollo/server/plugin/landingPage/default';
import { json } from 'body-parser';
import cors from 'cors';
import express from 'express';
import { Server } from 'http';
import Redis from 'ioredis';
import { buildSchema } from 'type-graphql';
import { isProd } from '../constants/config';
import { RoomResolver } from '../resolvers/roomResolver';
import { UserResolver } from '../resolvers/userResolver';
import { corsOptions } from '../server';
import { MyContext } from '../types';
import RedisRoomHelper from '../utils/redisRoomHelper';

const initApolloServer = async (
  app: express.Application,
  httpServer: Server,
  redis: Redis
): Promise<void> => {
  const schema = await buildSchema({
    resolvers: [UserResolver, RoomResolver],
    validate: false
  });

  // Setup Apollo Server with GraphQL
  const apolloServer = new ApolloServer<MyContext>({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      isProd
        ? ApolloServerPluginLandingPageProductionDefault({
            graphRef: 'my-graph-id@my-graph-variant',
            footer: false
          })
        : ApolloServerPluginLandingPageLocalDefault({
            footer: false,
            includeCookies: true
          })
    ]
  });

  await apolloServer.start();

  app.use(
    '/graphql',
    cors<cors.CorsRequest>(corsOptions),
    json(),
    expressMiddleware(apolloServer, {
      context: async ({ req, res }) => ({
        req,
        res,
        redisRoomHelper: new RedisRoomHelper(redis)
      })
    })
  );
};

export default initApolloServer;
