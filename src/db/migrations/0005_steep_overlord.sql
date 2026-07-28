CREATE TABLE "horses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" char(3),
	"foaled_year" smallint,
	"sex" text,
	"sire" text,
	"dam" text,
	CONSTRAINT "horses_name_country_code_foaled_year_key" UNIQUE("name","country_code","foaled_year")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"date" date NOT NULL,
	"going" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	CONSTRAINT "meetings_track_id_date_key" UNIQUE("track_id","date"),
	CONSTRAINT "meetings_status_check" CHECK ("meetings"."status" in ('scheduled','inprogress','completed','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "people_name_kind_key" UNIQUE("name","kind"),
	CONSTRAINT "people_kind_check" CHECK ("people"."kind" in ('jockey','trainer','owner'))
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"off_time" timestamp with time zone NOT NULL,
	"distance_yards" integer,
	"race_class" text,
	"race_type" text,
	"is_handicap" boolean DEFAULT false NOT NULL,
	"age_band" text,
	"prize_minor" bigint,
	"declared_runners" smallint,
	"actual_runners" smallint,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"result_version" integer DEFAULT 0 NOT NULL,
	"rule4_pence" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "races_provider_id_provider_ref_key" UNIQUE("provider_id","provider_ref"),
	CONSTRAINT "races_race_type_check" CHECK ("races"."race_type" is null or "races"."race_type" in ('flat','hurdle','chase','ntf','harness')),
	CONSTRAINT "races_status_check" CHECK ("races"."status" in ('scheduled','open','suspended','off','result','void','abandoned','postponed')),
	CONSTRAINT "races_rule4_pence_check" CHECK ("races"."rule4_pence" between 0 and 90),
	CONSTRAINT "races_result_requires_actual_runners" CHECK ("races"."status" <> 'result' or "races"."actual_runners" is not null)
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"jockey_id" uuid,
	"trainer_id" uuid,
	"cloth_number" smallint NOT NULL,
	"stall_draw" smallint,
	"weight_lb" smallint,
	"official_rating" smallint,
	"status" text DEFAULT 'declared' NOT NULL,
	"withdrawn_at_odds" numeric(10, 3),
	"starting_price" numeric(10, 3),
	"finish_position" smallint,
	"dead_heat_count" smallint DEFAULT 1 NOT NULL,
	"disqualified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "runners_race_id_cloth_number_key" UNIQUE("race_id","cloth_number"),
	CONSTRAINT "runners_status_check" CHECK ("runners"."status" in ('declared','non_runner','withdrawn','reserve')),
	CONSTRAINT "runners_dead_heat_count_check" CHECK ("runners"."dead_heat_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"surface" text,
	"timezone" text NOT NULL,
	CONSTRAINT "tracks_name_country_code_key" UNIQUE("name","country_code"),
	CONSTRAINT "tracks_surface_check" CHECK ("tracks"."surface" is null or "tracks"."surface" in ('turf','dirt','aw','sand','snow'))
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_jockey_id_people_id_fk" FOREIGN KEY ("jockey_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_trainer_id_people_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "races_off_time_idx" ON "races" USING btree ("off_time");--> statement-breakpoint
CREATE INDEX "races_status_off_time_idx" ON "races" USING btree ("status","off_time") WHERE status in ('open','suspended','off');--> statement-breakpoint
CREATE INDEX "runners_race_id_finish_position_idx" ON "runners" USING btree ("race_id","finish_position");--> statement-breakpoint
CREATE INDEX "runners_horse_id_idx" ON "runners" USING btree ("horse_id");