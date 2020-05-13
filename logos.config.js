module.exports = {
  apps : [
      {
        name: "Logos",
        script: "./app.js",
        watch: true,
        autorestart : true,
        env: {
	  "GOOGLE_APPLICATION_CREDENTIALS":"/home/chrx/.google/logos-162301-5257396ab743.json",
          "GCLOUD_PROJECT": "logos-162301",
          "CLOUD_BUCKET": "logos-162301",
          "DATASTORE_DATASET":"logos-162301",
          "DATASTORE_PROJECT_ID":"logos-162301",
          "MYSQL_USER":"logos",
          "MYSQL_PASSWORD":"sparkle8twilight",
          "MYSQL_DATABASE":"logos",
          "MYSQL_HOST":"localhost"
        }
      }
  ]
}