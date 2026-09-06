# Worked examples

Generated from examples/checkout by tools/skill-refs.mjs. The README's checkout system, grown one stage at a time;
every block below is a complete, valid model. The pictures each one produces are in the repository next to it.

Fuller galleries, each a model file with its pictures:

- **The kitchen sink**, every drawn variant: https://github.com/adamgilman/Orrery/blob/main/examples/kitchen-sink/README.md
- **The moving parts**, views, drill-down, scenarios, play, tour: https://github.com/adamgilman/Orrery/blob/main/examples/moving-parts/README.md
- **Orrery drawn in Orrery**, every feature in one file: https://github.com/adamgilman/Orrery/blob/main/examples/orrery.orrery.json

## 1-parts

Components alone render. Each has a kind; the defaults draw a client as a pill, a database as a cylinder. `kinds.use` pulls in the AWS pack so `aws:fargate` and `aws:rds` carry the provider's icons.

```json
{
  "$schema": "https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json",
  "title": "Checkout: the parts",
  "direction": "right",
  "kinds": {
    "use": [
      "aws"
    ]
  },
  "components": [
    {
      "id": "web",
      "label": "Storefront",
      "kind": "client"
    },
    {
      "id": "api",
      "label": "Checkout API",
      "kind": "aws:fargate"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "kind": "aws:rds"
    },
    {
      "id": "replica",
      "label": "Read replica",
      "kind": "aws:rds"
    },
    {
      "id": "sessions",
      "label": "Session cache",
      "kind": "aws:elasticache"
    }
  ],
  "exports": [
    {
      "id": "1-parts"
    }
  ]
}
```

## 2-groups

Groups are containers that mean something, nested as deep as the system goes. The view draws the session cache closed: one box the size of a component.

```json
{
  "$schema": "https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json",
  "title": "Checkout: grouped",
  "direction": "right",
  "kinds": {
    "use": [
      "aws"
    ]
  },
  "groups": [
    {
      "id": "data",
      "label": "Data",
      "kind": "tier"
    },
    {
      "id": "sessions",
      "label": "Session cache",
      "kind": "cluster",
      "parent": "data"
    },
    {
      "id": "cache-a",
      "label": "Node A",
      "kind": "cluster",
      "parent": "sessions"
    },
    {
      "id": "cache-b",
      "label": "Node B",
      "kind": "cluster",
      "parent": "sessions"
    }
  ],
  "components": [
    {
      "id": "web",
      "label": "Storefront",
      "kind": "client"
    },
    {
      "id": "api",
      "label": "Checkout API",
      "kind": "aws:fargate"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "replica",
      "label": "Read replica",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "redis-a",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-a"
    },
    {
      "id": "aof-a",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-a"
    },
    {
      "id": "redis-b",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-b"
    },
    {
      "id": "aof-b",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-b"
    }
  ],
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "collapse": [
        "sessions"
      ]
    }
  ],
  "exports": [
    {
      "id": "2-groups"
    }
  ]
}
```

## 3-connections

Connections are directed, drawn by their kind's line, animated by `load`. A connection may end on a group; the failover line carries no load yet.

```json
{
  "$schema": "https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json",
  "title": "Checkout: connected",
  "direction": "down",
  "kinds": {
    "use": [
      "aws"
    ]
  },
  "groups": [
    {
      "id": "data",
      "label": "Data",
      "kind": "tier"
    },
    {
      "id": "sessions",
      "label": "Session cache",
      "kind": "cluster",
      "parent": "data"
    },
    {
      "id": "cache-a",
      "label": "Node A",
      "kind": "cluster",
      "parent": "sessions"
    },
    {
      "id": "cache-b",
      "label": "Node B",
      "kind": "cluster",
      "parent": "sessions"
    }
  ],
  "components": [
    {
      "id": "web",
      "label": "Storefront",
      "kind": "client"
    },
    {
      "id": "api",
      "label": "Checkout API",
      "kind": "aws:fargate"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "replica",
      "label": "Read replica",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "redis-a",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-a"
    },
    {
      "id": "aof-a",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-a"
    },
    {
      "id": "redis-b",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-b"
    },
    {
      "id": "aof-b",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-b"
    }
  ],
  "connections": [
    {
      "from": "web",
      "to": "api",
      "load": 0.8
    },
    {
      "from": "api",
      "to": "db",
      "load": 0.6,
      "label": "writes"
    },
    {
      "id": "failover",
      "from": "api",
      "to": "replica",
      "load": 0
    },
    {
      "from": "db",
      "to": "replica",
      "kind": "replication",
      "load": 0.2
    },
    {
      "from": "api",
      "to": "sessions",
      "load": 0.5
    },
    {
      "from": "redis-a",
      "to": "aof-a",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "redis-b",
      "to": "aof-b",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "cache-a",
      "to": "cache-b",
      "kind": "replication",
      "load": 0.2
    }
  ],
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "collapse": [
        "sessions"
      ]
    }
  ],
  "exports": [
    {
      "id": "3-connections"
    }
  ]
}
```

## 4-scenarios

A scenario is cumulative steps. This one fails the primary, degrades two components with reasons, moves the failover load, and points at the replica with a callout. Two exports: a still of step 1, and the scenario playing on a loop.

```json
{
  "$schema": "https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json",
  "title": "Checkout: what happens",
  "direction": "down",
  "kinds": {
    "use": [
      "aws"
    ]
  },
  "groups": [
    {
      "id": "data",
      "label": "Data",
      "kind": "tier"
    },
    {
      "id": "sessions",
      "label": "Session cache",
      "kind": "cluster",
      "parent": "data"
    },
    {
      "id": "cache-a",
      "label": "Node A",
      "kind": "cluster",
      "parent": "sessions"
    },
    {
      "id": "cache-b",
      "label": "Node B",
      "kind": "cluster",
      "parent": "sessions"
    }
  ],
  "components": [
    {
      "id": "web",
      "label": "Storefront",
      "kind": "client"
    },
    {
      "id": "api",
      "label": "Checkout API",
      "kind": "aws:fargate"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "replica",
      "label": "Read replica",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "redis-a",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-a"
    },
    {
      "id": "aof-a",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-a"
    },
    {
      "id": "redis-b",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-b"
    },
    {
      "id": "aof-b",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-b"
    }
  ],
  "connections": [
    {
      "from": "web",
      "to": "api",
      "load": 0.8
    },
    {
      "from": "api",
      "to": "db",
      "load": 0.6,
      "label": "writes"
    },
    {
      "id": "failover",
      "from": "api",
      "to": "replica",
      "load": 0
    },
    {
      "from": "db",
      "to": "replica",
      "kind": "replication",
      "load": 0.2
    },
    {
      "from": "api",
      "to": "sessions",
      "load": 0.5
    },
    {
      "from": "redis-a",
      "to": "aof-a",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "redis-b",
      "to": "aof-b",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "cache-a",
      "to": "cache-b",
      "kind": "replication",
      "load": 0.2
    }
  ],
  "scenarios": [
    {
      "id": "db-fails",
      "label": "Primary fails",
      "steps": [
        {
          "note": "Orders DB goes down",
          "set": {
            "failed": "db",
            "degraded": {
              "api": "reads from the replica; writes are queued",
              "web": "checkout is slower"
            }
          },
          "load": [
            {
              "id": "failover",
              "load": 0.6
            }
          ],
          "callouts": [
            {
              "at": "replica",
              "text": "Reads move to the replica; writes queue until the primary is back"
            }
          ]
        }
      ]
    }
  ],
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "collapse": [
        "sessions"
      ]
    }
  ],
  "exports": [
    {
      "id": "4-scenarios-failed",
      "scenario": "db-fails",
      "step": 1
    },
    {
      "id": "4-scenarios-play",
      "play": "db-fails",
      "seconds": 3
    }
  ]
}
```

## 5-views

One model, two drawings: the overview, and the data tier scoped and laid out downwards. What lies outside a scoped view is a ghost.

```json
{
  "$schema": "https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json",
  "title": "Checkout: views",
  "direction": "down",
  "kinds": {
    "use": [
      "aws"
    ]
  },
  "groups": [
    {
      "id": "data",
      "label": "Data",
      "kind": "tier"
    },
    {
      "id": "sessions",
      "label": "Session cache",
      "kind": "cluster",
      "parent": "data"
    },
    {
      "id": "cache-a",
      "label": "Node A",
      "kind": "cluster",
      "parent": "sessions"
    },
    {
      "id": "cache-b",
      "label": "Node B",
      "kind": "cluster",
      "parent": "sessions"
    }
  ],
  "components": [
    {
      "id": "web",
      "label": "Storefront",
      "kind": "client"
    },
    {
      "id": "api",
      "label": "Checkout API",
      "kind": "aws:fargate"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "replica",
      "label": "Read replica",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "redis-a",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-a"
    },
    {
      "id": "aof-a",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-a"
    },
    {
      "id": "redis-b",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-b"
    },
    {
      "id": "aof-b",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-b"
    }
  ],
  "connections": [
    {
      "from": "web",
      "to": "api",
      "load": 0.8
    },
    {
      "from": "api",
      "to": "db",
      "load": 0.6,
      "label": "writes"
    },
    {
      "id": "failover",
      "from": "api",
      "to": "replica",
      "load": 0
    },
    {
      "from": "db",
      "to": "replica",
      "kind": "replication",
      "load": 0.2
    },
    {
      "from": "api",
      "to": "sessions",
      "load": 0.5
    },
    {
      "from": "redis-a",
      "to": "aof-a",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "redis-b",
      "to": "aof-b",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "cache-a",
      "to": "cache-b",
      "kind": "replication",
      "load": 0.2
    }
  ],
  "scenarios": [
    {
      "id": "db-fails",
      "label": "Primary fails",
      "steps": [
        {
          "note": "Orders DB goes down",
          "set": {
            "failed": "db",
            "degraded": {
              "api": "reads from the replica; writes are queued",
              "web": "checkout is slower"
            }
          },
          "load": [
            {
              "id": "failover",
              "load": 0.6
            }
          ],
          "callouts": [
            {
              "at": "replica",
              "text": "Reads move to the replica; writes queue until the primary is back"
            }
          ]
        }
      ]
    },
    {
      "id": "redis-fails",
      "label": "A cache process dies",
      "steps": [
        {
          "note": "Redis on node A dies",
          "set": {
            "failed": {
              "redis-a": "out of memory",
              "cache-a": "its process is down"
            },
            "degraded": {
              "sessions": "one node left",
              "api": "sessions load slowly"
            }
          },
          "load": [
            {
              "from": "cache-a",
              "to": "cache-b",
              "load": 0
            }
          ],
          "callouts": [
            {
              "at": "cache-a",
              "text": "One node left; sessions load slowly until it is back"
            }
          ]
        }
      ]
    }
  ],
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "collapse": [
        "sessions"
      ]
    },
    {
      "id": "data",
      "title": "Data tier",
      "scope": "data",
      "direction": "down",
      "collapse": [
        "sessions"
      ]
    }
  ],
  "exports": [
    {
      "id": "5-views-overview",
      "view": "overview"
    },
    {
      "id": "5-views-data",
      "view": "data"
    }
  ]
}
```

## 6-drill-down

Closed groups nest. The tour opens the cache, opens both nodes, zooms into node A, fails Redis, zooms out, closes everything: one drawing that moves.

```json
{
  "$schema": "https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json",
  "title": "Checkout: drill down",
  "direction": "down",
  "kinds": {
    "use": [
      "aws"
    ]
  },
  "groups": [
    {
      "id": "data",
      "label": "Data",
      "kind": "tier"
    },
    {
      "id": "sessions",
      "label": "Session cache",
      "kind": "cluster",
      "parent": "data"
    },
    {
      "id": "cache-a",
      "label": "Node A",
      "kind": "cluster",
      "parent": "sessions"
    },
    {
      "id": "cache-b",
      "label": "Node B",
      "kind": "cluster",
      "parent": "sessions"
    }
  ],
  "components": [
    {
      "id": "web",
      "label": "Storefront",
      "kind": "client"
    },
    {
      "id": "api",
      "label": "Checkout API",
      "kind": "aws:fargate"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "replica",
      "label": "Read replica",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "redis-a",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-a"
    },
    {
      "id": "aof-a",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-a"
    },
    {
      "id": "redis-b",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-b"
    },
    {
      "id": "aof-b",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-b"
    }
  ],
  "connections": [
    {
      "from": "web",
      "to": "api",
      "load": 0.8
    },
    {
      "from": "api",
      "to": "db",
      "load": 0.6,
      "label": "writes"
    },
    {
      "id": "failover",
      "from": "api",
      "to": "replica",
      "load": 0
    },
    {
      "from": "db",
      "to": "replica",
      "kind": "replication",
      "load": 0.2
    },
    {
      "from": "api",
      "to": "sessions",
      "load": 0.5
    },
    {
      "from": "redis-a",
      "to": "aof-a",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "redis-b",
      "to": "aof-b",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "cache-a",
      "to": "cache-b",
      "kind": "replication",
      "load": 0.2
    }
  ],
  "scenarios": [
    {
      "id": "db-fails",
      "label": "Primary fails",
      "steps": [
        {
          "note": "Orders DB goes down",
          "set": {
            "failed": "db",
            "degraded": {
              "api": "reads from the replica; writes are queued",
              "web": "checkout is slower"
            }
          },
          "load": [
            {
              "id": "failover",
              "load": 0.6
            }
          ],
          "callouts": [
            {
              "at": "replica",
              "text": "Reads move to the replica; writes queue until the primary is back"
            }
          ]
        }
      ]
    },
    {
      "id": "redis-fails",
      "label": "A cache process dies",
      "steps": [
        {
          "note": "Redis on node A dies",
          "set": {
            "failed": {
              "redis-a": "out of memory",
              "cache-a": "its process is down"
            },
            "degraded": {
              "sessions": "one node left",
              "api": "sessions load slowly"
            }
          },
          "load": [
            {
              "from": "cache-a",
              "to": "cache-b",
              "load": 0
            }
          ],
          "callouts": [
            {
              "at": "cache-a",
              "text": "One node left; sessions load slowly until it is back"
            }
          ]
        }
      ]
    }
  ],
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "collapse": [
        "sessions",
        "cache-a",
        "cache-b"
      ]
    },
    {
      "id": "data",
      "title": "Data tier",
      "scope": "data",
      "direction": "down",
      "collapse": [
        "sessions"
      ]
    },
    {
      "id": "checkout-seq",
      "type": "sequence",
      "title": "A customer checks out",
      "description": "The happy path: the storefront calls the API, the API writes the order and clears the session.",
      "messages": [
        {
          "from": "web",
          "to": "api",
          "text": "POST /checkout"
        },
        {
          "from": "api",
          "to": "sessions",
          "text": "read cart"
        },
        {
          "from": "api",
          "to": "db",
          "text": "insert order"
        },
        {
          "from": "db",
          "to": "api",
          "text": "ok",
          "reply": true
        },
        {
          "from": "api",
          "to": "sessions",
          "text": "clear cart"
        },
        {
          "from": "api",
          "to": "web",
          "text": "201 Created",
          "reply": true
        }
      ]
    }
  ],
  "tour": {
    "seconds": 4,
    "scenes": [
      {
        "view": "overview",
        "note": "The whole system. The session cache is one box."
      },
      {
        "view": "overview",
        "open": [
          "sessions"
        ],
        "note": "Open the session cache. The picture reflows; you still see everything."
      },
      {
        "view": "overview",
        "open": [
          "sessions",
          "cache-a",
          "cache-b"
        ],
        "note": "Open both nodes too. Still the whole system."
      },
      {
        "view": "overview",
        "open": [
          "sessions",
          "cache-a",
          "cache-b"
        ],
        "zoom": "cache-a",
        "note": "Zoom in on node A: a Redis process and its append-only file."
      },
      {
        "view": "overview",
        "open": [
          "sessions",
          "cache-a",
          "cache-b"
        ],
        "zoom": "cache-a",
        "scenario": "redis-fails",
        "step": 1,
        "note": "Redis dies. The step marks the node failed and the cluster and API degraded."
      },
      {
        "view": "overview",
        "open": [
          "sessions",
          "cache-a",
          "cache-b"
        ],
        "scenario": "redis-fails",
        "step": 1,
        "note": "Zoom out. Everything is still open; the states are where they were put."
      },
      {
        "view": "overview",
        "scenario": "redis-fails",
        "step": 1,
        "note": "Close it all. The closed boxes carry the state."
      }
    ]
  },
  "exports": [
    {
      "id": "6-drill-down"
    },
    {
      "id": "6-drill-down-inside",
      "open": [
        "sessions",
        "cache-a"
      ],
      "zoom": "cache-a"
    },
    {
      "id": "6-drill-down-tour",
      "tour": true
    }
  ]
}
```

## 7-vocabulary

The author's own states, replacing the defaults, each bound to a look; a custom line style. Nothing in the tool reads a name.

```json
{
  "$schema": "https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json",
  "title": "Checkout, in our words",
  "direction": "down",
  "kinds": {
    "use": [
      "aws"
    ]
  },
  "groups": [
    {
      "id": "data",
      "label": "Data",
      "kind": "tier"
    },
    {
      "id": "sessions",
      "label": "Session cache",
      "kind": "cluster",
      "parent": "data"
    },
    {
      "id": "cache-a",
      "label": "Node A",
      "kind": "cluster",
      "parent": "sessions"
    },
    {
      "id": "cache-b",
      "label": "Node B",
      "kind": "cluster",
      "parent": "sessions"
    }
  ],
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "collapse": [
        "sessions"
      ]
    }
  ],
  "states": {
    "replace": true,
    "default": "healthy",
    "define": {
      "healthy": {
        "look": "normal",
        "description": "Within SLO"
      },
      "impaired": {
        "look": "warn",
        "description": "Serving; redundancy or latency SLO breached"
      },
      "brownout": {
        "look": {
          "stroke": "#7c3aed",
          "fill": "#f5f3ff",
          "text": "#5b21b6",
          "pulse": true
        },
        "description": "Serving with a feature switched off"
      },
      "outage": {
        "look": "alert",
        "flows": "stop",
        "description": "Customer-visible failure"
      },
      "drained": {
        "look": "muted",
        "flows": "stop",
        "description": "Deliberately out of rotation"
      }
    }
  },
  "components": [
    {
      "id": "web",
      "label": "Storefront",
      "kind": "client"
    },
    {
      "id": "api",
      "label": "Checkout API",
      "kind": "aws:fargate"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "replica",
      "label": "Read replica",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "redis-a",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-a"
    },
    {
      "id": "aof-a",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-a"
    },
    {
      "id": "redis-b",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-b"
    },
    {
      "id": "aof-b",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-b"
    }
  ],
  "connections": [
    {
      "from": "web",
      "to": "api",
      "load": 0.8
    },
    {
      "from": "api",
      "to": "db",
      "load": 0.6,
      "label": "writes"
    },
    {
      "id": "failover",
      "from": "api",
      "to": "replica",
      "load": 0
    },
    {
      "from": "db",
      "to": "replica",
      "kind": "replication",
      "load": 0.2
    },
    {
      "from": "api",
      "to": "sessions",
      "load": 0.5
    },
    {
      "from": "redis-a",
      "to": "aof-a",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "redis-b",
      "to": "aof-b",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "cache-a",
      "to": "cache-b",
      "kind": "replication",
      "load": 0.2
    }
  ],
  "exports": [
    {
      "id": "7-vocabulary-play",
      "play": "cache-maintenance",
      "seconds": 4
    }
  ],
  "scenarios": [
    {
      "id": "cache-maintenance",
      "label": "Session cache maintenance",
      "steps": [
        {
          "note": "The cache cluster is drained: checkout continues for guests",
          "set": {
            "drained": [
              "sessions",
              "cache-a",
              "cache-b",
              "redis-a",
              "aof-a",
              "redis-b",
              "aof-b"
            ],
            "brownout": {
              "api": "guest checkout only: no saved carts"
            },
            "impaired": {
              "web": "signed-in customers check out as guests"
            }
          }
        }
      ]
    }
  ]
}
```

## 8-sequence

A sequence view: the messages of one request, in order, over connections the model already declares (a message with no connection under it is an error). Each participant is its own box on a lifeline, in its state; `reply: true` is the dashed return; `play.seconds` reveals one message per period. A sequence is its own drawing and its own file: `orrery render --view checkout-seq`.

```json
{
  "$schema": "https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json",
  "title": "Checkout: one request",
  "direction": "down",
  "kinds": {
    "use": [
      "aws"
    ]
  },
  "groups": [
    {
      "id": "data",
      "label": "Data",
      "kind": "tier"
    },
    {
      "id": "sessions",
      "label": "Session cache",
      "kind": "cluster",
      "parent": "data"
    },
    {
      "id": "cache-a",
      "label": "Node A",
      "kind": "cluster",
      "parent": "sessions"
    },
    {
      "id": "cache-b",
      "label": "Node B",
      "kind": "cluster",
      "parent": "sessions"
    }
  ],
  "components": [
    {
      "id": "web",
      "label": "Storefront",
      "kind": "client"
    },
    {
      "id": "api",
      "label": "Checkout API",
      "kind": "aws:fargate"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "replica",
      "label": "Read replica",
      "kind": "aws:rds",
      "group": "data"
    },
    {
      "id": "redis-a",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-a"
    },
    {
      "id": "aof-a",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-a"
    },
    {
      "id": "redis-b",
      "label": "Redis",
      "kind": "aws:elasticache",
      "group": "cache-b"
    },
    {
      "id": "aof-b",
      "label": "Append-only file",
      "kind": "aws:s3",
      "group": "cache-b"
    }
  ],
  "connections": [
    {
      "from": "web",
      "to": "api",
      "load": 0.8
    },
    {
      "from": "api",
      "to": "db",
      "load": 0.6,
      "label": "writes"
    },
    {
      "id": "failover",
      "from": "api",
      "to": "replica",
      "load": 0
    },
    {
      "from": "db",
      "to": "replica",
      "kind": "replication",
      "load": 0.2
    },
    {
      "from": "api",
      "to": "sessions",
      "load": 0.5
    },
    {
      "from": "redis-a",
      "to": "aof-a",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "redis-b",
      "to": "aof-b",
      "kind": "dataflow",
      "load": 0.3
    },
    {
      "from": "cache-a",
      "to": "cache-b",
      "kind": "replication",
      "load": 0.2
    }
  ],
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "collapse": [
        "sessions"
      ]
    },
    {
      "id": "checkout-seq",
      "type": "sequence",
      "title": "A customer checks out",
      "description": "The happy path: the storefront calls the API, the API writes the order and clears the session.",
      "messages": [
        {
          "from": "web",
          "to": "api",
          "text": "POST /checkout"
        },
        {
          "from": "api",
          "to": "sessions",
          "text": "read cart"
        },
        {
          "from": "api",
          "to": "db",
          "text": "insert order"
        },
        {
          "from": "db",
          "to": "api",
          "text": "ok",
          "reply": true
        },
        {
          "from": "api",
          "to": "sessions",
          "text": "clear cart"
        },
        {
          "from": "api",
          "to": "web",
          "text": "201 Created",
          "reply": true
        }
      ]
    }
  ],
  "exports": [
    {
      "id": "8-sequence",
      "view": "checkout-seq"
    }
  ]
}
```
