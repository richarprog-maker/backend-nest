module.exports = {
    apps: [
        {
            name: 'checor-backend',
            script: 'dist/src/main.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                ENABLE_TASKS: 'false',
                IS_TASK_WORKER: 'false',
            },
        },
        {
            name: 'checor-tasks',
            script: 'dist/src/main.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                ENABLE_TASKS: 'true',
                IS_TASK_WORKER: 'true',
            },
        },
    ],
};
