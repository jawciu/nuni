import bpy, sys, os, math
SPIKE = os.path.expanduser("~/Code/daytona-spike")
OUT   = os.path.expanduser("~/Code/nuni/public/assets")
os.makedirs(OUT, exist_ok=True)

# name -> (path, scale to metres)
JOBS = {
  "body":   (f"{SPIKE}/body/caroline_drop12.obj", 1.0),   # already metres
  "tee":    (f"{SPIKE}/cat/top_cropped.obj",      0.01),  # cm -> m
  "trews":  (f"{SPIKE}/cat/trews_wide.obj",       0.01),
}

for name,(path,scale) in JOBS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    objs = [o for o in bpy.context.scene.objects if o.type=="MESH"]
    for o in objs:
        o.scale = (scale,scale,scale)
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # normals: sim OBJ has none
    for o in objs:
        me = o.data
        me.calc_normals_split() if hasattr(me,"calc_normals_split") else None
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_smooth()
    dst = f"{OUT}/{name}.glb"
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB",
        export_yup=True, export_apply=True, export_normals=True,
        export_materials="NONE", export_draco_mesh_compression_enable=False)
    print(f"[to_glb] {name} -> {dst}  objs={len(objs)}  verts={sum(len(o.data.vertices) for o in objs)}")
print("[to_glb] DONE")
