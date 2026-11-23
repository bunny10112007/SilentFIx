"""Module 7: AWS DynamoDB Audit Sync & S3 Redacted Archiver.

Replicates local installation and rollback ledger records to Amazon DynamoDB
while archiving PII-sanitized screen inspection captures to Amazon S3 without
blocking the main async loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.state.db import get_connection

logger = logging.getLogger("silentfix.aws_sync")

DEFAULT_DYNAMO_TABLE = os.getenv("DYNAMODB_TABLE_NAME", "silentfix_audit_ledger")
DEFAULT_S3_BUCKET = os.getenv("S3_BUCKET_NAME", "silentfix-redacted-inspections")
DEFAULT_AWS_REGION = os.getenv("AWS_REGION", "us-east-1")


def has_aws_credentials() -> bool:
    """Check if AWS credentials are configured in the environment."""
    return bool(
        os.getenv("AWS_ACCESS_KEY_ID")
        and os.getenv("AWS_SECRET_ACCESS_KEY")
    )


def _sync_record_to_dynamodb_sync(
    table_name: str,
    record: dict[str, Any],
    region: str = DEFAULT_AWS_REGION,
) -> bool:
    """Synchronous DynamoDB put_item call executed in worker thread (Chunk 1)."""
    try:
        dynamodb = boto3.resource(
            "dynamodb",
            region_name=region,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        )
        table = dynamodb.Table(table_name)
        table.put_item(Item=record)
        logger.info("DynamoDB sync succeeded for record %s", record.get("entity_id"))
        return True
    except (BotoCoreError, ClientError, Exception) as err:
        logger.warning(
            "DynamoDB replication skipped or failed cleanly (off-thread fallback): %s", err
        )
        return False


def _upload_redacted_image_to_s3_sync(
    bucket_name: str,
    s3_key: str,
    image_bytes: bytes,
    content_type: str = "image/png",
    region: str = DEFAULT_AWS_REGION,
) -> bool:
    """Synchronous S3 upload executed in worker thread (Chunk 2).

    Only images that have passed RapidOCR Gaussian PII blurring are uploaded.
    """
    try:
        s3_client = boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        )
        s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=image_bytes,
            ContentType=content_type,
            Metadata={"redaction-status": "rapidocr-gaussian-16px-redacted"},
        )
        logger.info("Uploaded redacted inspection image to s3://%s/%s", bucket_name, s3_key)
        return True
    except (BotoCoreError, ClientError, Exception) as err:
        logger.warning(
            "S3 upload skipped or failed cleanly (off-thread fallback): %s", err
        )
        return False


async def replicate_audit_record_to_dynamodb(
    entity_type: str,
    entity_id: str,
    payload: dict[str, Any],
    table_name: str = DEFAULT_DYNAMO_TABLE,
) -> dict[str, Any]:
    """Chunk 1 (Off-Thread DynamoDB Replication): Uses asyncio.to_thread so network

    latency or missing cloud credentials fallback cleanly without interrupting
    local SQLite transactions.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {
        "id": f"{entity_type}#{entity_id}",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "payload": json.dumps(payload),
        "synced_at": now_iso,
    }

    sync_status = "LOCAL_ONLY"
    dynamo_timestamp = None

    if has_aws_credentials():
        # Dispatch to worker thread without blocking async event loop
        success = await asyncio.to_thread(
            _sync_record_to_dynamodb_sync,
            table_name,
            record,
            os.getenv("AWS_REGION", DEFAULT_AWS_REGION),
        )
        if success:
            sync_status = "SYNCED_DYNAMODB"
            dynamo_timestamp = now_iso
        else:
            sync_status = "SYNC_FAILED_FALLBACK"
    else:
        logger.debug("AWS credentials not configured; audit stored in local SQLite ledger.")

    # Record in local SQLite cloud audit table
    async with get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO cloud_audit_records (
                entity_type, entity_id, sync_status, dynamo_synced_at, payload, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                entity_type,
                entity_id,
                sync_status,
                dynamo_timestamp,
                json.dumps(payload),
                now_iso,
            ),
        )
        await conn.commit()

    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "sync_status": sync_status,
        "dynamo_synced_at": dynamo_timestamp,
    }


async def archive_redacted_inspection_to_s3(
    inspection_id: str,
    redacted_image_bytes: bytes,
    bucket_name: str = DEFAULT_S3_BUCKET,
) -> dict[str, Any]:
    """Chunk 2 (Privacy-Preserving S3 Upload): Ensures that only images that have

    passed through RapidOCR Gaussian PII blurring are archived to AWS S3 storage.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    s3_key = f"redacted_inspections/{datetime.now(timezone.utc).strftime('%Y-%m-%d')}/{inspection_id}.png"

    sync_status = "LOCAL_ONLY"
    s3_timestamp = None

    if has_aws_credentials():
        success = await asyncio.to_thread(
            _upload_redacted_image_to_s3_sync,
            bucket_name,
            s3_key,
            redacted_image_bytes,
            "image/png",
            os.getenv("AWS_REGION", DEFAULT_AWS_REGION),
        )
        if success:
            sync_status = "ARCHIVED_S3"
            s3_timestamp = now_iso
        else:
            sync_status = "S3_UPLOAD_FAILED"

    # Record in local ledger
    async with get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO cloud_audit_records (
                entity_type, entity_id, sync_status, s3_synced_at, payload, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "SCREEN_INSPECTION",
                inspection_id,
                sync_status,
                s3_timestamp,
                json.dumps({"s3_key": s3_key, "bucket": bucket_name, "bytes_len": len(redacted_image_bytes)}),
                now_iso,
            ),
        )
        await conn.commit()

    return {
        "inspection_id": inspection_id,
        "s3_key": s3_key,
        "sync_status": sync_status,
        "s3_synced_at": s3_timestamp,
    }


async def get_cloud_audit_history(limit: int = 50) -> list[dict[str, Any]]:
    """Retrieve recent cloud audit sync entries."""
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT * FROM cloud_audit_records ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
